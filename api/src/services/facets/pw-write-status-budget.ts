import { and, eq, sql } from "drizzle-orm";
import { pwWriteStatusBudgets } from "../../db/schema-pw-write.js";
import type { WriteTx } from "./signal-write-scope.js";
import { PwWriteError } from "./pw-write-errors.js";

/** Absolute I/P window, shared across connections, tabs and process reloads. */
export async function reservePwIntentStatus(tx: WriteTx, intentId: string,
  pageSessionId: string, clock: () => number = Date.now): Promise<void> {
  intentId = intentId.toLowerCase();
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
    ${JSON.stringify(["pw-status", intentId, pageSessionId])}, 0))`);
  const key = and(eq(pwWriteStatusBudgets.intentId, intentId),
    eq(pwWriteStatusBudgets.pageSessionId, pageSessionId));
  const [budget] = await tx.select().from(pwWriteStatusBudgets).where(key);
  const now = clock();
  if (!Number.isSafeInteger(now)) throw new PwWriteError(503, "write_fence_unavailable");
  if (!budget) {
    await tx.insert(pwWriteStatusBudgets).values({ intentId, pageSessionId,
      firstReadAt: new Date(now), lastReadAt: new Date(now), initialReads: 1 });
    return;
  }
  const initial = now < budget.firstReadAt.getTime() + 120_000;
  const spacing = initial ? 2000 : 30_000;
  if (now - budget.lastReadAt.getTime() < spacing || (initial && budget.initialReads >= 60)) {
    throw new PwWriteError(429, "write_rate_limited");
  }
  await tx.update(pwWriteStatusBudgets).set({ lastReadAt: new Date(now),
    initialReads: budget.initialReads + (initial ? 1 : 0) }).where(key);
}
