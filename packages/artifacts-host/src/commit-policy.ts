import type pg from "pg";
import type { AuthorizeCommit, CommitPolicyParticipantFactory } from "@sentropic/artifacts/server/commit-contract";
import type { ActivationConfig } from "./activation.js";
import { POLICY_REVISION } from "./transaction-authority.js";

/** Every policy read and provisional reservation uses the coordinator's client. */
export async function createHostPolicy(pool: pg.Pool, scope: string,
  readActivation?: () => ActivationConfig): Promise<CommitPolicyParticipantFactory> {
  await pool.query("INSERT INTO artifacts.host_policy (storage_scope_id, revision) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [scope, POLICY_REVISION]);
  return { createParticipant(client, transactionToken) {
    return {
      async readRevision() {
        const result = await client.query<{ revision: string }>(
          "SELECT revision FROM artifacts.host_policy WHERE storage_scope_id = $1 FOR SHARE", [scope]);
        if (!result.rows[0]) throw new Error("artifact policy unavailable");
        return result.rows[0].revision;
      },
      async checkApproval({ actorId }: { actorId: string }) {
        const revision = await client.query<{ revision: string }>(
          "SELECT revision FROM artifacts.host_policy WHERE storage_scope_id = $1 FOR SHARE", [scope]);
        const account = await client.query<{ id: string; status: string }>(
          "SELECT id, status FROM account_users WHERE sub = $1 FOR SHARE", [actorId]);
        const activation = readActivation?.();
        const activationOpen = !activation || (activation.enabled &&
          activation.expiresAtMs > Date.now() && activation.subjects.includes(actorId));
        const approvedAccount = account.rows[0]?.status === "approved";
        const revisionOk = revision.rows[0]?.revision === POLICY_REVISION;
        if (!revisionOk || !approvedAccount || !activationOpen) {
          let publicCode = "access_denied";
          const status = 403;
          if (revisionOk && approvedAccount && activation) {
            if (!activation.enabled || activation.expiresAtMs <= Date.now()) publicCode = "activation_closed";
            else if (!activation.subjects.includes(actorId)) publicCode = "not_in_cohort";
            else publicCode = "account_not_approved";
          } else if (revisionOk && !approvedAccount) {
            publicCode = "account_not_approved";
          }
          return { approved: false as const, reason: "denied" as const, publicCode, status };
        }
        const accountId = account.rows[0]?.id;
        const memberships = await client.query<{ workspace_id: string }>(
          "SELECT workspace_id FROM workspace_memberships WHERE account_id = $1 " +
            "AND status = 'active' AND revoked_at IS NULL FOR SHARE",
          [accountId]);
        const unique = [...new Set(memberships.rows.map((row) => String(row.workspace_id).toLowerCase()))];
        if (unique.length === 0) {
          return { approved: false as const, reason: "denied" as const,
            publicCode: "workspace_membership_required", status: 403 };
        }
        if (unique.length !== 1) {
          return { approved: false as const, reason: "denied" as const,
            publicCode: "workspace_ambiguous", status: 409 };
        }
        return { approved: true as const };
      },
      async reserveQuota({ storageScopeId, bytes }) {
        if (storageScopeId !== scope) return { reserved: false };
        const result = await client.query(
          `UPDATE artifacts.host_quotas SET operations_used = operations_used + 1, bytes_used = bytes_used + $2
           WHERE storage_scope_id = $1 AND operations_used < operation_limit AND bytes_used + $2 <= byte_limit`,
          [scope, bytes]);
        return { reserved: result.rowCount === 1 };
      },
      mintFence(policyRevision, invocationId) {
        return { fenceId: transactionToken, transactionId: transactionToken, invocationId, policyRevision };
      },
    };
  } };
}

/** No authority is inferred from a stored receipt; replay rereads the participant. */
export const authorizeArtifactCommit: AuthorizeCommit = async (context, transaction) => {
  const participant = transaction.participant;
  const revision = await participant.readRevision();
  if (revision !== context.policyRevision) {
    return { allowed: false, reason: "revoked", publicCode: "access_denied", status: 403, retriable: false };
  }
  const admission = await participant.readAdmission({ ...context, policyRevision: revision });
  if (admission.allowed) {
    return { allowed: true, fence: participant.mintFence(revision, context.invocationId) };
  }
  if (typeof participant.checkApproval === "function") {
    try {
      const detail = await participant.checkApproval({ actorId: context.actorId, operation: context.operation }) as {
        approved: boolean; publicCode?: unknown; status?: unknown };
      if (!detail.approved && typeof detail.publicCode === "string" &&
        /^[a-z][a-z0-9_]{0,63}$/.test(detail.publicCode)) {
        const status = detail.status === 409 ? 409 : 403;
        return { allowed: false, reason: "denied", publicCode: detail.publicCode, status, retriable: false };
      }
    } catch {
      // Fall through to the generic typed refusal below; the transaction rolls back.
    }
  }
  if (admission.reason === "invalid_object") {
    return { allowed: false, reason: "denied", publicCode: "access_denied", status: 403, retriable: false };
  }
  return { allowed: false, reason: "revoked", publicCode: "access_denied", status: 403, retriable: false };
};
