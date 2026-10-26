import { eq } from "drizzle-orm";
import { pwWriteIntents } from "../../db/schema-pw-write.js";
import type { WriteTx } from "./signal-write-scope.js";
import { loadPwIntentForUpdate } from "./pw-write-store.js";
import { appendPwOutbox } from "./pw-write-outbox.js";
import { appendPwAudit } from "./pw-write-audit.js";

const TERMINAL_CONFLICTS = new Set(["projection_revision_conflict", "facet_head_conflict",
  "target_version_conflict", "workspace_revision_conflict", "invalid_reason_code", "reason_code_required"]);

/** Called only after BASE has refused and rolled back; never overwrite a winner. */
export async function recordPwRejection(tx: WriteTx, intentId: string, error: unknown): Promise<boolean> {
  if (!(error instanceof Error) || !TERMINAL_CONFLICTS.has(error.message)) return false;
  const row = await loadPwIntentForUpdate(tx, intentId);
  if (row.executionState !== "pending" || row.revokedAt !== null) return true;
  await tx.update(pwWriteIntents).set({ executionState: "rejected", decidedAt: new Date() })
    .where(eq(pwWriteIntents.intentId, row.intentId));
  await appendPwAudit(tx, { intentId: row.intentId, invocationId: row.invocationId,
    operation: row.operation, workspaceId: row.workspaceId, principal: row.principal,
    operationDigest: row.operationDigest, intentDigest: row.intentDigest,
    artifactRef: row.artifactRef as Record<string, unknown>, result: "denied" });
  await appendPwOutbox(tx, { intentId: row.intentId, kind: "write_rejected",
    payload: { intentId: row.intentId, code: error.message } });
  return true;
}
