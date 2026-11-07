import type { GitCodeRightsPort } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import type { GitToolAuthority, GitToolInvocation } from "./provider-adapter.js";

/**
 * Per-user authority of the git tools (M2-I, Δ4). The acting user writes
 * only through their own artifact, holding current code rights and the host
 * write scope; there is no platform-owner shortcut. Reads (fetch_app_source)
 * are gated by code rights inside the provider.
 */
export interface ArtifactOwnerPort {
  ownerOf(storageScopeId: string, artifactId: string): Promise<string | undefined>;
}

export interface GitToolAuthorityDeps {
  readonly owners: ArtifactOwnerPort;
  readonly codeRights: GitCodeRightsPort;
  readonly repoId: string;
  readonly hasWriteScope: () => boolean;
}

export function createGitToolAuthorize(deps: GitToolAuthorityDeps) {
  return async (invocation: GitToolInvocation, artifactId: string): Promise<GitToolAuthority> => {
    const ownerId = await deps.owners.ownerOf(invocation.storageScopeId, artifactId);
    if (ownerId === undefined) throw new ArtifactOperationError("not_found");
    const own = ownerId === invocation.actorId;
    const canWrite = own && deps.hasWriteScope() && await deps.codeRights.canReadCode({
      storageScopeId: invocation.storageScopeId, repoId: deps.repoId, actorId: invocation.actorId });
    return { ownerId, canWrite };
  };
}

interface Queryable { query<R extends object>(text: string, values: unknown[]): Promise<{ rows: R[] }> }

export function createPostgresArtifactOwners(pool: Queryable): ArtifactOwnerPort {
  return {
    async ownerOf(storageScopeId, artifactId) {
      const result = await pool.query<{ owner_id: string }>(
        "SELECT owner_id FROM artifacts.artifacts WHERE id = $1 AND storage_scope_id = $2", [artifactId, storageScopeId]);
      return result.rows[0]?.owner_id;
    },
  };
}
