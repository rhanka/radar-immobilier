/**
 * Cutover freeze (zero-downtime blue/green): while the previous database is read-only,
 * PostgreSQL refuses writes with 25006 (read_only_sql_transaction) and terminates sessions
 * opened before the freeze with 57P01 (admin_shutdown). Both become an explicit, retryable
 * 503 instead of a generic 500.
 */
import type { Context } from "hono";
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
