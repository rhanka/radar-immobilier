import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { WriteTx } from "../services/facets/signal-write-scope.js";
import { PwWriteError } from "../services/facets/pw-write-errors.js";

/** One wall-clock budget across SQL statements; cancel only this pinned backend. */
export function writeIntentTransaction<T>(db: Database, work: (tx: WriteTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const started = performance.now();
    await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    const { rows: [{ pid }] } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    let expired = false;
    let cancellation: Promise<unknown> | undefined;
    const timer = setTimeout(() => {
      expired = true;
      // Keep the transaction/backend pinned until cancellation has completed.
      // A failed cancellation still cannot let overdue work commit below.
      cancellation = Promise.resolve(db.execute(sql`SELECT pg_cancel_backend(${pid})`)).catch(() => {});
    }, Math.max(1, 5000 - (performance.now() - started)));
    try {
      const result = await work(tx);
      if (expired || performance.now() - started >= 5000) throw new PwWriteError(503, "write_fence_unavailable");
      return result;
    }
    catch (error) {
      let cause = error;
      while (cause instanceof Error && cause.cause) cause = cause.cause;
      const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
      if (code === "55P03" || code === "57014") throw new PwWriteError(503, "write_fence_unavailable");
      throw error;
    }
    finally {
      clearTimeout(timer);
      await cancellation;
    }
  });
}
