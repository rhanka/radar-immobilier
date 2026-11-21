import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Database } from "../../db/client.js";
import { schema } from "../../db/schema.js";

export const DEFAULT_REANNOTATION_STATEMENT_TIMEOUT_MS = 5_000;
export const REANNOTATION_LIST_STATEMENT_TIMEOUT_MS = 30_000;
export const MAX_REANNOTATION_STATEMENT_TIMEOUT_MS = 120_000;

export interface ReannotationDbOptions {
  statementTimeoutMs?: number;
}

/** Destroy the dedicated session on cancellation; never return a running query to the pool. */
export async function withReannotationDb<T>(db: Database, signal: AbortSignal | undefined,
  operation: (bounded: Database) => Promise<T>, options?: ReannotationDbOptions): Promise<T> {
  const timeoutMs = options?.statementTimeoutMs ?? DEFAULT_REANNOTATION_STATEMENT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_REANNOTATION_STATEMENT_TIMEOUT_MS) {
    throw new Error(`Reannotation statementTimeoutMs must be an integer from 1 to ${MAX_REANNOTATION_STATEMENT_TIMEOUT_MS}`);
  }
  signal?.throwIfAborted();
  const pool = (db as Database & { $client: pg.Pool }).$client;
  const client = await pool.connect(); // The application pool bounds acquisition to 3 seconds.
  let released = false;
  const release = () => { if (!released) { released = true; client.release(true); } };
  const abort = () => release();
  client.on("error", abort);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    await client.query(`SET statement_timeout = '${timeoutMs}ms'`);
    await client.query("SET lock_timeout = '1s'");
    const result = await operation(drizzle(client, { schema }));
    signal?.throwIfAborted();
    return result;
  } finally {
    signal?.removeEventListener("abort", abort);
    release();
  }
}
