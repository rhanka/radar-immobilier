import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type Pool, type PoolClient } from "pg";
import type { Database } from "../db/client.js";
import { schema } from "../db/schema.js";
import type { WriteTx } from "../services/facets/signal-write-scope.js";
import { PwWriteError } from "../services/facets/pw-write-errors.js";

/** One budget from pool acquisition to precommit; abort only our leased connection. */
export async function writeIntentTransaction<T>(db: Database, work: (tx: WriteTx) => Promise<T>): Promise<T> {
  const started = performance.now();
  const pool = (db as Database & { $client: Pool }).$client;
  let client: PoolClient | undefined;
  let expired = false;
  let destroyed = false;
  let control: pg.Client | undefined;
  let pid: number | undefined;
  let cancellation: Promise<unknown> | undefined;
  const connectionError = () => {};
  let timer: ReturnType<typeof setTimeout>;
  const unavailable = () => new PwWriteError(503, "write_fence_unavailable");
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      // Reserve this independent control connection BEFORE BEGIN. Socket closure alone
      // does not interrupt a running PostgreSQL statement or immediately free its locks.
      cancellation = (pid && control
        ? control.query("SELECT pg_terminate_backend($1, 250)", [pid]) : Promise.resolve())
        .catch(() => {}).then(() => {
          if (client) { destroyed = true; client.release(true); }
          reject(unavailable());
        });
    }, Math.max(1, 5000 - (performance.now() - started)));
  });
  const transaction = (async () => {
    const connection = await pool.connect().catch(() => { throw unavailable(); });
    // Pool acquisition itself is not cancellable. Return any late lease without work.
    if (expired) { connection.release(); throw unavailable(); }
    client = connection;
    client.on("error", connectionError);
    // pg-pool deliberately makes its password property non-enumerable.
    control = new pg.Client({ ...pool.options, password: pool.options.password,
      connectionTimeoutMillis: 500, query_timeout: 300 });
    control.on("error", connectionError);
    await control.connect().catch(() => { throw unavailable(); });
    if (expired) throw unavailable();
    const backend = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    pid = backend.rows[0]?.pid;
    if (!pid || !Number.isSafeInteger(pid) || expired) throw unavailable();
    return drizzle(connection, { schema }).transaction(async (tx) => {
      try {
        await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
        const result = await work(tx);
        if (expired || performance.now() - started >= 5000) throw new PwWriteError(503, "write_fence_unavailable");
        // COMMIT acknowledgement errors remain uncertain and must not become no-effect refusals.
        clearTimeout(timer);
        return result;
      }
      catch (error) {
        let cause = error;
        while (cause instanceof Error && cause.cause) cause = cause.cause;
        const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
        if (code === "55P03" || code === "57014") throw unavailable();
        throw error;
      }
    });
  })();
  try { return await Promise.race([deadline, transaction]); }
  catch (error) { if (expired) throw unavailable(); throw error; }
  finally {
    clearTimeout(timer!);
    await cancellation;
    if (client && !destroyed) client.release();
    client?.off("error", connectionError);
    await control?.end();
  }
}
