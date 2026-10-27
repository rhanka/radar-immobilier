/**
 * PW-C application dispatch: confirm and revoke by intentId.
 *
 * The route owns the cookie/CSRF/challenge gates; this module only runs the
 * admitted command (PW-B coordinator) or the serialized revocation (PW-D
 * fences) and shapes the public responses. It never reads the request.
 */
import type { Database } from "../db/client.js";
import { assertPwPrincipal, type PwConfirmation } from "../services/facets/pw-write-confirmation.js";
import { confirmPwSignalWrite } from "../services/facets/pw-write-confirm.js";
import type { PwPrincipal } from "../services/facets/pw-write-digests.js";
import { loadPwIntentForShare, loadPwIntentForUpdate, type PwIntentRow } from "../services/facets/pw-write-store.js";
import { revokePwIntent } from "../services/facets/pw-write-fences.js";
import { assertSignalWriteInput, type SignalWriteInput } from "../services/facets/signal-write-operations.js";
import { approvedAccountId } from "../services/workspaces/store.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { PwWriteError } from "../services/facets/pw-write-errors.js";
import { writeIntentTransaction } from "./write-intent-transaction.js";

export interface CommittedWriteIntent {
  readonly intentId: string;
  readonly state: "committed";
  readonly commandId: string;
  readonly receipt: { readonly event: unknown };
  readonly nextAction: "refresh_state";
}

export interface RevokedWriteIntent {
  readonly intentId: string;
  readonly authorizationState: "revoked";
  readonly commandState: "committed" | "not_committed";
  readonly revokedAt: string;
}

/** Execute the prepared command exactly once; replay stays 409 consumed. */
export async function confirmWriteIntent(db: Database, row: PwIntentRow,
  proof: PwConfirmation): Promise<CommittedWriteIntent> {
  assertSignalWriteInput(row.command);
  const principal = row.principal as PwPrincipal;
  const result = await confirmPwSignalWrite(db, principal.sub, row.intentId,
    row.command as SignalWriteInput, { confirmation: proof });
  return { intentId: row.intentId, state: "committed", commandId: row.commandKey,
    receipt: { event: result.event }, nextAction: "refresh_state" };
}

/**
 * Revoke by intentId without requiring current business rights: ownership is
 * proven by the principal check; a withdrawn approval falls back to the
 * stored actor instead of closing the management path.
 */
export async function revokeWriteIntent(db: Database, row: PwIntentRow,
  principal: PwPrincipal): Promise<RevokedWriteIntent> {
  const outcome = await writeIntentTransaction(db, async (tx) => {
    const live = await loadPwIntentForUpdate(tx, row.intentId);
    assertPwPrincipal(live, principal);
    let actorId: string;
    try {
      actorId = await approvedAccountId(tx, principal.sub, true);
    } catch (error) {
      if (!(error instanceof WorkspaceError)) throw error;
      actorId = live.actorId;
    }
    const revoked = await revokePwIntent(tx, row.intentId, actorId, principal);
    const fresh = await loadPwIntentForShare(tx, row.intentId);
    if (!(fresh.revokedAt instanceof Date)) throw new PwWriteError(503, "write_fence_unavailable");
    return { committed: revoked.committed, revokedAt: fresh.revokedAt.toISOString() };
  });
  return { intentId: row.intentId, authorizationState: "revoked",
    commandState: outcome.committed ? "committed" : "not_committed",
    revokedAt: outcome.revokedAt };
}
