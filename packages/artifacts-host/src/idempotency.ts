
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
  return new pg.Pool({
    host: params.host,
    port: params.port,
    user: params.user,
    password: params.password,
    database: params.database,
    connectionTimeoutMillis: 3000,
    max,
  });
}

const ADVISORY_KEY_RE = /^[0-9a-f]{16,}[0-9a-f]*$/i;

export async function withArtifactAdvisoryLock<T>(
  pool: pg.Pool,
  keyHex: string,
  body: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!ADVISORY_KEY_RE.test(keyHex)) {
    throw new Error("withArtifactAdvisoryLock: keyHex must be hex (16+ chars)");
  }
  const lockId = keyHex.slice(0, 16);
  const client = await pool.connect();
  let discard = false;
  const unlock = async () => {
    try {
      await client.query("SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)", [lockId]);
    } catch (error) {
      discard = true;
      throw error;
    }
  };
  try {
    try {
      await client.query(
        "SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)",
        [lockId],
      );
      const result = await body(client);
      return result;
    } finally {
      await unlock();
    }
  } finally {
    client.release(discard);
  }
}
