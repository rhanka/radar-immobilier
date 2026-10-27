import type pg from "pg";
import { parseManifest } from "@sentropic/artifacts/codecs";
import type { HttpAppDeps, HttpResponse } from "@sentropic/artifacts/http";
import type { ArtifactInvocationContext, FinalizeTxClient } from "@sentropic/artifacts/server/commit-contract";
import { createPostgresPublicationUnitWriter, decidePublishAuthorization } from "@sentropic/artifacts/server/publication";
import type { ArtifactOutcome } from "@sentropic/artifacts/server/outcome-contract";

/** Reuse the coordinator and provider ACL predicate; never serve a raw receipt. */
export async function replayPublication(options: {
  pool: pg.Pool;
  coordinator: HttpAppDeps["coordinator"];
  command: ReturnType<HttpAppDeps["profile"]["validators"]["normalizeCommand"]>;
  invocation: ArtifactInvocationContext;
  publicationUrls?: HttpAppDeps["publicationUrls"];
}): Promise<ArtifactOutcome<HttpResponse>> {
  const { pool, coordinator, command, invocation } = options;
  const artifactId = String(command.payload.artifactId);
  const revision = await pool.query<{ revision: string }>(
    "SELECT revision FROM artifacts.host_policy WHERE storage_scope_id=$1", [invocation.storageScopeId]);
  if (!revision.rows[0]) throw new Error("artifact policy unavailable");
  let client: FinalizeTxClient | undefined;
  const lock = (table: string, column: string) => async (tx: FinalizeTxClient) => {
    client = tx;
    await tx.query(`SELECT ${column} FROM artifacts.${table} WHERE ${column}=$1 FOR UPDATE`, [artifactId]);
  };
  const outcome = await coordinator.replayPrepared({
    scopeId: invocation.storageScopeId, internalKey: command.identity.internalKey,
    commandHash: command.identity.commandHash, codecVersion: command.identity.codecVersion,
    invocationId: invocation.invocationId, actorId: invocation.actorId,
    operation: "publish", artifactId, bindingName: null, policyRevision: revision.rows[0].revision,
    receiptData: undefined,
    locks: { "artifact-lifecycle": [lock("artifacts", "id")],
      acl: [lock("artifact_access", "artifact_id")], "current-pointer": [lock("artifact_current", "artifact_id")] },
    async guard(context, transaction) {
      if (!client) throw new Error("publication replay transaction unavailable");
      const { state, acl } = await createPostgresPublicationUnitWriter(client).readAuthorization(artifactId);
      const verdict = decidePublishAuthorization({ lifecycleState: state, acl, actorId: context.actorId });
      if (acl?.storageScopeId !== invocation.storageScopeId || !verdict.allowed) {
        return { allowed: false, reason: "denied", publicCode: "access_denied", status: 403, retriable: false };
      }
      return invocation.authorizeCommit(context, transaction);
    },
  });
  if (!outcome.ok) return outcome;
  const receipt = outcome.result.receipt as { releaseId: string; manifest: string };
  const manifest = parseManifest(receipt.manifest);
  if (manifest.artifactId !== artifactId || typeof receipt.releaseId !== "string") {
    throw new Error("invalid publication replay receipt");
  }
  return { ...outcome, result: { status: 201, body: {
    artifactId, releaseId: receipt.releaseId, manifest: receipt.manifest, digest: manifest.digest,
    ...options.publicationUrls?.(artifactId, receipt.releaseId),
  } } };
}
