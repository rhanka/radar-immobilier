import type { Database } from "../db/client.js";
import type { PwIntentRow } from "../services/facets/pw-write-store.js";
import { readCommittedSignalReceipt } from "../services/facets/signal-write-receipt.js";
import { PwWriteError } from "../services/facets/pw-write-errors.js";
import { assertWriteIntentState, type WriteIntentState } from "./write-intent-schemas.js";
import { isWriteRefusalCode } from "./write-intent-refusal.js";

/** Closed public union: no raw durable row, actor, challenge, or command. */
export async function projectWriteIntentStatus(db: Database, row: PwIntentRow, state: WriteIntentState,
  rejection?: { code: string } | null) {
  assertWriteIntentState(state);
  if (state === "committed") return { intentId: row.intentId, state,
    commandId: row.commandKey, receipt: { event: await readCommittedSignalReceipt(
      db, (row.principal as { sub: string }).sub, row.workspaceId, row.commandKey) },
    nextAction: "refresh_state" as const };
  if (state === "pending") return { intentId: row.intentId, state, expiresAt: row.expiresAt.toISOString() };
  // Only PW-D's persisted public refusal may describe a terminal rejection.
  if (state === "rejected") {
    if (!rejection || !isWriteRefusalCode(rejection.code)) throw new PwWriteError(503, "write_authority_unavailable");
    return { intentId: row.intentId, state, error: { code: rejection.code } };
  }
  return { intentId: row.intentId, state };
}
