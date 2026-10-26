import { createHash } from "node:crypto";
import pg from "pg";

export interface IdempotencyKeyInput {
  readonly scope: string;
  readonly sub: string;
  readonly op: string;
  readonly artifactId: string;
  readonly clientKey: string;
}

export function deriveIdempotencyKey(input: IdempotencyKeyInput): string {
  const joined = [input.scope, input.sub, input.op, input.artifactId, input.clientKey].join("|");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function computeParamsHash(params: unknown): string {
  const canonical = JSON.stringify(canonicalize(params)) ?? "null";
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface ArtifactsPoolParams {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export function createArtifactsPool(
  params: ArtifactsPoolParams,
  max = 5,
): pg.Pool {
  const pool = new pg.Pool({
    host: params.host,
    port: params.port,
    user: params.user,
    password: params.password,
    database: params.database,
    connectionTimeoutMillis: 3000,
    options: "-c lock_timeout=1000 -c statement_timeout=5000",
    max,
  });
  return guardArtifactPool(pool);
}

/** Typed failure for a Postgres connection lost while a client is reserved. */
export class ArtifactConnectionError extends Error {
  readonly code = "artifact_connection_lost";
  constructor(message = "artifact postgres connection lost", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ArtifactConnectionError";
  }
}

/** pg-pool emits a plain Error without code when acquisition times out. */
export const ARTIFACT_POOL_TIMEOUT_CODE = "artifact_pool_timeout";

export function isPoolAcquisitionTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === ARTIFACT_POOL_TIMEOUT_CODE) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout exceeded when trying to connect/i.test(message) ||
    /connection terminated due to connection timeout/i.test(message);
}

/** Keep every reserved client from crashing the process on a network break. */
const guardedPools = new WeakSet<object>();

export function guardArtifactPool(pool: pg.Pool): pg.Pool {
  if (guardedPools.has(pool) || typeof pool.connect !== "function") return pool;
  guardedPools.add(pool as object);
  pool.on?.("error", () => console.error("artifact pool idle client error"));
  const originalConnect = pool.connect.bind(pool);
  const protect = (client: pg.PoolClient): pg.PoolClient => {
    let broken: Error | undefined;
    const onError = (error: Error): void => {
      broken ??= error;
    };
    client.on("error", onError);
    const originalRelease = client.release.bind(client);
    client.release = (error?: Error | boolean) => {
      client.removeListener("error", onError);
      originalRelease(error || broken);
    };
    return client;
  };
  // pool.query uses callback acquisition; the coordinator uses promises.
  pool.connect = ((callback?: (error: Error | undefined, client?: pg.PoolClient,
    release?: pg.PoolClient["release"]) => void) => {
    if (!callback) return originalConnect().then(protect);
    return originalConnect((error, client) => {
      if (error || !client) return callback(error);
      const guarded = protect(client);
      callback(undefined, guarded, guarded.release);
    });
  }) as typeof pool.connect;
  return pool;
}

export function normalizePoolAcquisitionError(error: unknown): unknown {
  if (isPoolAcquisitionTimeout(error)) {
    const code = (error as { code?: unknown }).code;
    if (code === ARTIFACT_POOL_TIMEOUT_CODE) return error;
    return Object.assign(new Error("artifact pool acquisition timed out", { cause: error }),
      { code: ARTIFACT_POOL_TIMEOUT_CODE });
  }
  return error;
}

const ADVISORY_KEY_RE = /^[0-9a-f]{16,}[0-9a-f]*$/i;

const CONNECTION_FAILURE_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ERR_SOCKET_CLOSED",
  "ETIMEDOUT",
]);

function isConnectionFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "55P03") return false;
  if (typeof code === "string" && CONNECTION_FAILURE_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /terminating connection|connection terminated|connection reset|socket hang up|broken pipe|connection error|connection closed/i.test(message);
}

export async function withArtifactAdvisoryLock<T>(
  pool: pg.Pool,
  keyHex: string,
  body: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!ADVISORY_KEY_RE.test(keyHex)) {
    throw new Error("withArtifactAdvisoryLock: keyHex must be hex (16+ chars)");
  }
  const lockId = keyHex.slice(0, 16);
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isPoolAcquisitionTimeout(error)) throw normalizePoolAcquisitionError(error);
    if (isConnectionFailure(error)) {
      throw new ArtifactConnectionError("artifact postgres connection lost", { cause: error });
    }
    throw error;
  }
  let discard = false;
  let locked = false;
  let connectionError: unknown = null;
  let rejectOnConnectionError: ((reason: ArtifactConnectionError) => void) | undefined;
  const connectionLost = new Promise<never>((_, reject) => {
    rejectOnConnectionError = reject;
  });
  // The race below may already be settled when the connection fails during
  // unlock/release: keep a no-op branch so the rejection is never unhandled.
  void connectionLost.catch(() => {});
  // pg-pool removes its error handler from reserved clients and pool "error"
  // only covers idle clients, so guard the reserved client for the whole
  // reservation. Without this listener the "error" event would throw.
  const onClientError = (error: Error): void => {
    if (connectionError !== null) return;
    connectionError = error;
    discard = true;
    rejectOnConnectionError?.(
      new ArtifactConnectionError("artifact postgres connection lost", { cause: error }),
    );
  };
  const onClientEnd = (): void => {
    onClientError(new Error("artifact postgres connection ended"));
  };
  client.on("error", onClientError);
  client.on("end", onClientEnd);
  const guard = <U>(work: Promise<U>): Promise<U> => Promise.race([work, connectionLost]);
  const guardedCleanup = async (work: Promise<unknown>): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        guard(work),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new ArtifactConnectionError("artifact postgres connection lost",
            { cause: new Error("artifact postgres cleanup timeout") })), 5000);
        }),
      ]);
    } finally { clearTimeout(timer); }
  };
  const cleanup = async (): Promise<void> => {
    try {
      // A dead session already released its advisory lock: never query it.
      if (locked && connectionError === null) {
        await guardedCleanup(client.query("SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)", [lockId]));
      }
      if (connectionError !== null) {
        throw new ArtifactConnectionError("artifact postgres connection lost", { cause: connectionError });
      }
    } catch (error) {
      discard = true;
      if (connectionError === null && isConnectionFailure(error)) connectionError = error;
      if (connectionError !== null) {
        throw new ArtifactConnectionError("artifact postgres connection lost", { cause: connectionError });
      }
      throw error;
    } finally {
      client.removeListener("error", onClientError);
      client.removeListener("end", onClientEnd);
      // Pass an error to destroy the broken client instead of pooling it.
      if (connectionError instanceof Error) {
        client.release(connectionError);
      } else if (connectionError !== null) {
        client.release(new ArtifactConnectionError("artifact postgres connection lost", { cause: connectionError }));
      } else if (discard) {
        client.release(new Error("artifact pool client discarded"));
      } else {
        client.release();
      }
    }
  };
  try {
    try {
      await guard(client.query("BEGIN"));
      await guard(client.query("SELECT set_config('lock_timeout', $1, true)", ["3000ms"]));
      await guard(client.query(
        "SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)",
        [lockId],
      ));
      locked = true;
      await guard(client.query("SELECT set_config('lock_timeout', '0', true)"));
      await guard(client.query("COMMIT"));
    } catch (error) {
      if (connectionError === null) {
        try {
          await guardedCleanup(client.query("ROLLBACK"));
        } catch { discard = true; }
      }
      if ((error as { code?: string }).code === "55P03") {
        throw new Error("artifact advisory lock timeout conflict", { cause: error });
      }
      throw error;
    }
    if (connectionError !== null) {
      throw new ArtifactConnectionError("artifact postgres connection lost", { cause: connectionError });
    }
    const result = await Promise.race([body(client), connectionLost]);
    if (connectionError !== null) {
      throw new ArtifactConnectionError("artifact postgres connection lost", { cause: connectionError });
    }
    return result;
  } catch (error) {
    if (connectionError !== null) {
      throw new ArtifactConnectionError("artifact postgres connection lost", { cause: connectionError });
    }
    if (isConnectionFailure(error)) {
      connectionError = error;
      discard = true;
      throw new ArtifactConnectionError("artifact postgres connection lost", { cause: error });
    }
    throw error;
  } finally {
    await cleanup();
  }
}
