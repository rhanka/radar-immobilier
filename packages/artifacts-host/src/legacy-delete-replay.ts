import type pg from "pg";
import type { HttpAppDeps, HttpResponse } from "@sentropic/artifacts/http";
import type { ArtifactInvocationContext, FinalizeTxClient } from "@sentropic/artifacts/server/commit-contract";
import type { ArtifactOutcome } from "@sentropic/artifacts/server/outcome-contract";
import type { createRadarKeyDerivation } from "@sentropic/artifacts/mcp-core";
import { deriveIdempotencyKey } from "./idempotency.js";

/** Decode P0b's server-bound confirmation snapshot solely to verify an existing v1 receipt.
 * Incoming omission remains untouched. This path can only replay, never finalize a command.
 */
export async function replayLegacyDelete(options: {
  pool: pg.Pool; profile: HttpAppDeps["profile"]; coordinator: HttpAppDeps["coordinator"];
  invocation: ArtifactInvocationContext; args: Record<string, unknown>;
  derivation: ReturnType<typeof createRadarKeyDerivation>;
}): Promise<ArtifactOutcome<HttpResponse> | undefined> {
  const { pool, profile, coordinator, invocation, args } = options;
  const internalKey = deriveIdempotencyKey({ scope: invocation.storageScopeId, sub: invocation.actorId,
    op: "delete", artifactId: String(args.artifactId), clientKey: String(args.idempotencyKey) });
  const prior = await pool.query<{ expected_release_id: string | null; command_hash: string }>(
    `SELECT d.expected_release_id, r.command_hash FROM artifacts.delete_confirmations d
     JOIN artifacts.operation_receipts r ON r.storage_scope_id=d.storage_scope_id AND r.internal_key=d.internal_key
       AND r.command_hash=d.command_hash AND r.command_codec='artifacts-command/v1'
     WHERE d.storage_scope_id=$1 AND d.actor_id=$2 AND d.artifact_id=$3 AND d.internal_key=$4`,
    [invocation.storageScopeId, invocation.actorId, args.artifactId, internalKey]);
  if (!prior.rows[0]) return undefined;
  const command = profile.validators.normalizeCommand({
    derivation: options.derivation, authority: { actorId: invocation.actorId, storageScopeId: invocation.storageScopeId },
    capability: "artifacts_delete", args: { ...args, expectedCurrentReleaseId: prior.rows[0].expected_release_id },
  });
  const artifactId = String(args.artifactId);
  let client: FinalizeTxClient | undefined;
  const lock = (table: string, column: string) => async (transaction: FinalizeTxClient) => {
    client = transaction;
    await transaction.query(`SELECT ${column} FROM artifacts.${table} WHERE ${column}=$1 FOR UPDATE`, [artifactId]);
  };
  const revision = (await pool.query<{ revision: string }>(
    "SELECT revision FROM artifacts.host_policy WHERE storage_scope_id=$1", [invocation.storageScopeId])).rows[0]?.revision;
  if (!revision) throw new Error("artifact_policy_unavailable");
  const outcome = await coordinator.replayPrepared({ scopeId: invocation.storageScopeId, internalKey: command.identity.internalKey,
    commandHash: command.identity.commandHash, codecVersion: command.identity.codecVersion,
    actorId: invocation.actorId, invocationId: invocation.invocationId, operation: "delete", artifactId,
    bindingName: null, policyRevision: revision, receiptData: undefined,
    locks: { "artifact-lifecycle": [lock("artifacts", "id")], acl: [lock("artifact_access", "artifact_id")],
      "current-pointer": [lock("artifact_current", "artifact_id")] },
    async guard(context, transaction) {
      const owner = await client!.query<{ owner_id: string; storage_scope_id: string }>(
        "SELECT owner_id,storage_scope_id FROM artifacts.artifacts WHERE id=$1", [artifactId]);
      if (owner.rows[0]?.owner_id !== invocation.actorId || owner.rows[0]?.storage_scope_id !== invocation.storageScopeId) {
        return { allowed: false, reason: "denied", publicCode: "access_denied", status: 403, retriable: false };
      }
      return invocation.authorizeCommit(context, transaction);
    },
  });
  return outcome.ok ? { ...outcome, result: { status: 200, body: outcome.result.receipt } } : outcome;
}
