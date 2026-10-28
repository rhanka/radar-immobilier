import { loadPwIntentForShare, type PwIntentRow } from "../services/facets/pw-write-store.js";
import { assertPwPrincipal } from "../services/facets/pw-write-confirmation.js";
import { readCommittedSignalReceiptInTx } from "../services/facets/signal-write-receipt.js";
import { appendPwAudit } from "../services/facets/pw-write-audit.js";
import { PwWriteError } from "../services/facets/pw-write-errors.js";
import type { AppGuardPass } from "./write-intent-app-guard.js";
import { canReadWriteIntentSummaryInTx, type WriteAppDeps } from "./write-intent-app-authority.js";
import { writeIntentTransaction } from "./write-intent-transaction.js";
import { pwIntentStatus } from "../services/facets/pw-write-fences.js";

/** App consultation outlives P; ownership, current rights and I stay locked. */
export async function readAppWriteIntentResult(deps: WriteAppDeps, observed: PwIntentRow, pass: AppGuardPass) {
  return writeIntentTransaction(deps.db, async (tx) => {
    const row = await loadPwIntentForShare(tx, observed.intentId);
    assertPwPrincipal(row, pass.principal);
    const canRead = await canReadWriteIntentSummaryInTx(tx, row, pass);
    if ((deps.nowMs ?? Date.now)() >= pass.session.exp * 1000) throw new PwWriteError(401, "session_expired");
    // Linearize the public status while holding I; never expire a stale pending row.
    const state = { state: pwIntentStatus(row, (deps.nowMs ?? Date.now)()), executionState: row.executionState,
      revocationState: row.revokedAt === null ? "active" : "revoked" };
    if (row.executionState !== "committed" || !canRead) return { row, data: state, canRead };
    // The BASE reader validates its receipt/context and current scope, never old 6L1.
    const event = await readCommittedSignalReceiptInTx(tx, pass.principal.sub, row.workspaceId, row.commandKey);
    await appendPwAudit(tx, { intentId: row.intentId, invocationId: row.invocationId, commandId: row.commandKey,
      operation: row.operation, workspaceId: row.workspaceId, target: row.target,
      scope: row.operation.includes(".workspace.") ? "workspace" : "personal",
      artifactRef: row.artifactRef as Record<string, unknown>, grantRef: row.grantReference,
      principal: pass.principal, operationDigest: row.operationDigest, intentDigest: row.intentDigest, result: "receipt_read" });
    if ((deps.nowMs ?? Date.now)() >= pass.session.exp * 1000) throw new PwWriteError(401, "session_expired");
    return { row, data: { ...state, commandId: row.commandKey, receipt: { event }, nextAction: "refresh_state" as const }, canRead };
  });
}
