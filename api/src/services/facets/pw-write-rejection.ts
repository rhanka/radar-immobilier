import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pwWriteIntents, pwWriteRejections } from "../../db/schema-pw-write.js";
import type { WriteTx } from "./signal-write-scope.js";
import { loadPwIntentForUpdate } from "./pw-write-store.js";
import { appendPwOutbox } from "./pw-write-outbox.js";
import { appendPwAudit } from "./pw-write-audit.js";
import { FacetError } from "./target.js";
import { PwWriteError } from "./pw-write-errors.js";
import { ScopeError } from "./scope.js";
import { WorkspaceError } from "../workspaces/types.js";

const TERMINAL_CONFLICTS = {
  projection_revision_conflict: 409, facet_head_conflict: 409,
  facet_target_version_conflict: 409, workspace_revision_conflict: 409,
  invalid_reason_code: 422, reason_code_required: 422,
} as const;
type TerminalCode = keyof typeof TERMINAL_CONFLICTS;

export function isPwKnownRefusal(error: unknown): error is Error {
  return error instanceof FacetError || error instanceof PwWriteError
    || error instanceof ScopeError || error instanceof WorkspaceError;
}

export function pwTerminalRefusal(error: unknown) {
  if (!isPwKnownRefusal(error)) return null;
  const code = error.message === "target_version_conflict" ? "facet_target_version_conflict" : error.message;
  if (!Object.hasOwn(TERMINAL_CONFLICTS, code)) return null;
  return { status: TERMINAL_CONFLICTS[code as TerminalCode], code: code as TerminalCode };
}

export async function readPwRejection(tx: WriteTx, intentId: string) {
  const [row] = await tx.select().from(pwWriteRejections)
    .where(eq(pwWriteRejections.intentId, intentId.toLowerCase()));
  if (!row) return null;
  if (!Object.hasOwn(TERMINAL_CONFLICTS, row.code)
    || row.status !== TERMINAL_CONFLICTS[row.code as TerminalCode]) {
    throw new PwWriteError(503, "write_fence_unavailable");
  }
  return { status: row.status as 409 | 422, code: row.code as TerminalCode };
}

/** Called only after BASE has refused and rolled back; never overwrite a winner. */
export async function recordPwRejection(tx: WriteTx, intentId: string, error: unknown,
  requestId: string = randomUUID()): Promise<boolean> {
  const refusal = pwTerminalRefusal(error);
  if (!refusal) return false;
  const row = await loadPwIntentForUpdate(tx, intentId);
  if (row.executionState !== "pending" || row.revokedAt !== null) return false;
  await tx.insert(pwWriteRejections).values({ intentId: row.intentId, ...refusal });
  await tx.update(pwWriteIntents).set({ executionState: "rejected", decidedAt: new Date() })
    .where(eq(pwWriteIntents.intentId, row.intentId));
  await appendPwAudit(tx, { requestId, intentId: row.intentId, invocationId: row.invocationId,
    operation: row.operation, workspaceId: row.workspaceId, principal: row.principal,
    operationDigest: row.operationDigest, intentDigest: row.intentDigest,
    artifactRef: row.artifactRef as Record<string, unknown>, result: "denied" });
  await appendPwOutbox(tx, { intentId: row.intentId, kind: "write_rejected",
    payload: { intentId: row.intentId, ...refusal } });
  return true;
}
