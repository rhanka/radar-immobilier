import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { WriteTx } from "../services/facets/signal-write-scope.js";
import { PwWriteError } from "../services/facets/pw-write-errors.js";

/** Bound SQL waits; only proven pre-commit cancellation is a known refusal. */
export function writeIntentTransaction<T>(db: Database, work: (tx: WriteTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    try { return await work(tx); }
    catch (error) {
      let cause = error;
      while (cause instanceof Error && cause.cause) cause = cause.cause;
      const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
      if (code === "55P03" || code === "57014") throw new PwWriteError(503, "write_fence_unavailable");
      throw error;
    }
  });
}
