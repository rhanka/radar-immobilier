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
      async checkApproval({ actorId }) {
        const result = await client.query<{ status: string }>(
          "SELECT status FROM account_users WHERE sub = $1 FOR SHARE", [actorId]);
        const activation = readActivation?.();
        const active = !activation || (activation.enabled && activation.expiresAtMs > Date.now() &&
          activation.subjects.includes(actorId));
        return { approved: result.rows[0]?.status === "approved" && active, reason: "denied" as const };
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
  const revision = await transaction.participant.readRevision();
  const admission = await transaction.participant.readAdmission({ ...context, policyRevision: revision });
  if (revision !== context.policyRevision || !admission.allowed) {
    return { allowed: false, reason: "revoked", publicCode: "access_denied", status: 403, retriable: false };
  }
  return { allowed: true, fence: transaction.participant.mintFence(revision, context.invocationId) };
};
