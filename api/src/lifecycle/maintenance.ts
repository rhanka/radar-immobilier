/**
 * Cutover freeze (zero-downtime blue/green): while the previous database is read-only,
 * PostgreSQL refuses writes with 25006 (read_only_sql_transaction) and terminates sessions
 * opened before the freeze with 57P01 (admin_shutdown). Both become an explicit, retryable
 * 503 instead of a generic 500.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

const MAINTENANCE_CODES = new Set(["25006", "57P01"]);

/** True when the error, or any error in its `cause` chain, carries a freeze SQLSTATE. */
export function isMaintenanceError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && MAINTENANCE_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Response for a request refused by the freeze: 503 maintenance_read_only, retry in 5 s. */
export function maintenanceResponse(c: Context): Response {
  c.header("Retry-After", "5");
  return c.json({ error: "maintenance_read_only" }, 503);
}

/** Application error handler: freeze errors are explicit 503, anything else stays a 500. */
export function handleAppError(error: Error, c: Context): Response {
  if (isMaintenanceError(error)) return maintenanceResponse(c);
  if (error instanceof HTTPException) return error.getResponse();
  console.error(error);
  return c.text("Internal Server Error", 500);
}

// Routes that catch a database error themselves answer their own 500: the freeze still has to
// surface as the explicit 503. Every query error is reported to the request that issued it.
const scope = new AsyncLocalStorage<{ frozen: boolean }>();

/** Request middleware: a 5xx answered after a freeze error becomes 503 maintenance_read_only. */
export const maintenanceGuard: MiddlewareHandler = async (c, next) => {
  const state = { frozen: false };
  await scope.run(state, () => next());
  if (state.frozen && c.res.status >= 500 && c.res.status !== 503) {
    c.res = new Response(JSON.stringify({ error: "maintenance_read_only" }), {
      status: 503, headers: { "content-type": "application/json", "retry-after": "5" },
    });
  }
};

interface QueryClient {
  query: (...args: unknown[]) => unknown;
  on(event: "error", listener: (error: Error & { code?: string }) => void): unknown;
}

function reporting(client: { query: (...args: unknown[]) => unknown }): void {
  const original = client.query.bind(client);
  client.query = (...args: unknown[]) => {
    // The request is captured when the query starts: driver callbacks may run in another context.
    const state = scope.getStore();
    const report = (error: unknown) => { if (state && isMaintenanceError(error)) state.frozen = true; };
    const last = args.at(-1);
    if (typeof last === "function") {
      args[args.length - 1] = (error: unknown, result: unknown) => {
        if (error) report(error);
        return (last as (e: unknown, r: unknown) => unknown)(error, result);
      };
    }
    const outcome = original(...args);
    if (outcome && typeof (outcome as Promise<unknown>).then === "function") {
      return (outcome as Promise<unknown>).catch((error: unknown) => { report(error); throw error; });
    }
    return outcome;
  };
}

/**
 * Freeze-safe pool: a session terminated by the server (cutover freeze/unfreeze, restart) must
 * never crash the process, idle or checked out (pg-pool removes its own listener while a client
 * is borrowed), and every query error is reported to the issuing request.
 */
interface PoolLike {
  query: (...args: unknown[]) => unknown;
  on(event: "error" | "connect", listener: (value: never) => void): unknown;
}

// Typed loosely: the pg Pool event overloads are not assignable to a single signature.
export function instrumentPool(target: object): void {
  const pool = target as PoolLike;
  const lost = (error: Error & { code?: string }) => {
    console.warn(JSON.stringify({ level: "warn", msg: "postgres session lost", code: error.code ?? null }));
  };
  pool.on("error", lost);
  pool.on("connect", (client: QueryClient) => {
    client.on("error", lost);
    reporting(client);
  });
  reporting(pool);
}
