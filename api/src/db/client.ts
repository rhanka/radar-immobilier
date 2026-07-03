import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import type { AppConfig } from "../config.js";
import type { ProbeResult } from "../routes/health.js";
import { schema } from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
}

export function createDb(config: AppConfig): DbHandle {
  const pool = new pg.Pool({
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: config.POSTGRES_DB,
    // Bound the connection wait so an unreachable Postgres fails fast instead of
    // hanging checkDb()/requests until the k8s probe timeout kills the pod
    // (crash-loop cause C2, radar-api-memory-study-2026-07-02.md). Small pool:
    // the api is I/O-light per request and runs on ½ core.
    connectionTimeoutMillis: 3000,
    max: 5,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Health probe: a trivial round-trip query. */
export function makeDbProbe(handle: DbHandle): () => Promise<ProbeResult> {
  return async () => {
    await handle.db.execute(sql`select 1`);
    return { ok: true };
  };
}
