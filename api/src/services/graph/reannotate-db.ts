import type pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Database } from "../../db/client.js";
import { schema } from "../../db/schema.js";

/** Destroy the dedicated session on cancellation; never return a running query to the pool. */
export async function withReannotationDb<T>(db: Database, signal: AbortSignal | undefined,
  operation: (bounded: Database) => Promise<T>): Promise<T> {
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
    await client.query("SET statement_timeout = '5s'");
    await client.query("SET lock_timeout = '1s'");
    const result = await operation(drizzle(client, { schema }));
    signal?.throwIfAborted();
    return result;
  } finally {
    signal?.removeEventListener("abort", abort);
    release();
  }
}
