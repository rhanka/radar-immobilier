import type pg from "pg";
import type { AuthorizeCommit, CommitPolicyParticipantFactory } from "@sentropic/artifacts/server/commit-contract";
import { isGeneralActivation, type ActivationConfig } from "./activation.js";
import { POLICY_REVISION } from "./transaction-authority.js";
import { sharePrincipalApproved } from "./p0b-ports.js";

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
      async checkApproval({ actorId, operation }: { actorId: string; operation: string }) {
        if (!await sharePrincipalApproved(client, operation)) {
          return { approved: false as const, reason: "denied" as const, publicCode: "access_denied", status: 403 };
        }
        const revision = await client.query<{ revision: string }>(
          "SELECT revision FROM artifacts.host_policy WHERE storage_scope_id = $1 FOR SHARE", [scope]);
        const account = await client.query<{ id: string; status: string }>(
          "SELECT id, status FROM account_users WHERE sub = $1 FOR SHARE", [actorId]);
        const activation = readActivation?.();
        const general = activation !== undefined && isGeneralActivation(activation);
        const activationOpen = !activation || general || (activation.enabled &&
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
        if (general) {
          // General opening: approved accounts publish with zero, one or
          // several memberships; the storage scope stays a server namespace.
          // No workspace is reported, so no façade freezes it.
          return { approved: true as const, workspaceId: "" };
        }
        const accountId = account.rows[0]?.id;
        const memberships = await client.query<{ workspace_id: string }>(
          "SELECT workspace_id FROM workspace_memberships WHERE account_id = $1 " +
            "AND status = 'active' AND revoked_at IS NULL FOR SHARE",
          [accountId]);
        const freshActivation = readActivation?.();
        const freshOpen = !freshActivation || (freshActivation.enabled &&
          freshActivation.expiresAtMs > Date.now() && freshActivation.subjects.includes(actorId));
        if (!freshOpen && freshActivation) {
          if (!freshActivation.enabled || freshActivation.expiresAtMs <= Date.now()) {
            return { approved: false as const, reason: "denied" as const,
              publicCode: "activation_closed", status: 403 };
          }
          return { approved: false as const, reason: "denied" as const,
            publicCode: "not_in_cohort", status: 403 };
        }
        if (!freshOpen) {
          return { approved: false as const, reason: "denied" as const,
            publicCode: "access_denied", status: 403 };
        }
        const freshAccount = await client.query<{ status: string }>(
          "SELECT status FROM account_users WHERE sub = $1 FOR SHARE", [actorId]);
        if (freshAccount.rows[0]?.status !== "approved") {
          return { approved: false as const, reason: "denied" as const,
            publicCode: "account_not_approved", status: 403 };
        }
        const unique = [...new Set(memberships.rows.map((row) => String(row.workspace_id).toLowerCase()))];
        if (unique.length === 0) {
          return { approved: false as const, reason: "denied" as const,
            publicCode: "workspace_membership_required", status: 403 };
        }
        if (unique.length !== 1) {
          return { approved: false as const, reason: "denied" as const,
            publicCode: "workspace_ambiguous", status: 409 };
        }
        const workspaceId = unique[0]!;
        if (readActivation !== undefined && workspaceId !== scope.toLowerCase()) {
          return { approved: false as const, reason: "denied" as const,
            publicCode: "workspace_membership_required", status: 403 };
        }
        return { approved: true as const, workspaceId };
      },
      async reserveQuota({ storageScopeId, actorId, bytes }) {
        if (storageScopeId !== scope) return { reserved: false };
        const result = await client.query(
          `UPDATE artifacts.host_quotas SET operations_used = operations_used + 1, bytes_used = bytes_used + $2
           WHERE storage_scope_id = $1 AND operations_used < operation_limit AND bytes_used + $2 <= byte_limit`,
          [scope, bytes]);
        if (result.rowCount !== 1) return { reserved: false };
        // Per-actor durable ceiling, auto-provisioned once from the global row
        // so no manual step per user is ever required; a missing global row
        // provisions nothing and the update below blocks the commit.
        await client.query(
          `INSERT INTO artifacts.host_actor_quotas (storage_scope_id, actor_id, operation_limit, byte_limit)
           SELECT $1, $2, operation_limit, byte_limit FROM artifacts.host_quotas WHERE storage_scope_id = $1
           ON CONFLICT (storage_scope_id, actor_id) DO NOTHING`,
          [scope, actorId]);
        const actor = await client.query(
          `UPDATE artifacts.host_actor_quotas SET operations_used = operations_used + 1, bytes_used = bytes_used + $3
           WHERE storage_scope_id = $1 AND actor_id = $2
             AND operations_used < operation_limit AND bytes_used + $3 <= byte_limit`,
          [scope, actorId, bytes]);
        if (actor.rowCount !== 1) return { reserved: false };
        return { reserved: true };
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
