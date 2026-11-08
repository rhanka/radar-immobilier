import type { GitBindingStore, GitCodeRightsPort, GitHumanDirectory, GitRepositoryRegistry, LiveAuthority, LiveInvocation } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { IMMO_GIT_OUTPUT_DIR } from "./registry.js";

/**
 * Live authority and the content-host reader gate (M4-I, Δ4), OWNER-ONLY.
 *
 * - Each user edits THEIR OWN personal binding: the binding owner is the
 *   acting user (`personalPrincipalId`), never a platform owner. Writes need
 *   current code rights, the host write scope and a GitHub linkage.
 * - Anyone else, including other code-rights holders, is refused
 *   (`access_denied`); a different principal never writes to someone else's
 *   binding (co-editing would be a contract change).
 *
 * Invited live readers are GENERIC in @sentropic/artifacts 0.2.22 (train 1c:
 * artifacts_live_invite / _accept_invitation / _revoke_invitation /
 * _invitations, package migration 0013_live_invitations, `liveViewer` and
 * `liveInvitationState`). The immo invitation store of #1030 (table
 * artifacts.live_invitations, migration 0038) is removed and its table
 * dropped by migration 0041 so the package migration can create its own.
 * TODO(0.2.22): compose the package `invitations` host port and admit the
 * invitee path through `liveViewer(identity, principalId)`.
 *
 * Code rights are evaluated on every call: there is no cached authority.
 */
export interface LiveAuthorityDeps {
  readonly bindings: GitBindingStore;
  readonly registry: GitRepositoryRegistry;
  readonly codeRights: GitCodeRightsPort;
  readonly directory: GitHumanDirectory;
  readonly hasWriteScope: () => boolean;
  /** Worker qualification (GB4 / M4-lite). False until qualified: live_write answers builder_unavailable. */
  readonly qualified: () => boolean;
}

const denied = (): never => { throw new ArtifactOperationError("access_denied"); };

async function bindingContext(deps: Pick<LiveAuthorityDeps, "bindings" | "registry">, storageScopeId: string, artifactId: string) {
  const binding = await deps.bindings.get(storageScopeId, artifactId);
  if (!binding || binding.state === "detached") throw new ArtifactOperationError("git_not_attached");
  if (binding.channel !== "personal" || !binding.personalPrincipalId) return denied();
  const repository = await deps.registry.get(binding.storageScopeId, binding.repoId);
  if (!repository) throw new ArtifactOperationError("git_repo_not_registered");
  return { binding, repository, ownerId: binding.personalPrincipalId };
}

export function createLiveAuthorize(deps: LiveAuthorityDeps) {
  return async (invocation: LiveInvocation, artifactId: string): Promise<LiveAuthority> => {
    const { binding, repository, ownerId } = await bindingContext(deps, invocation.storageScopeId, artifactId);
    // Owner-only until the generic invitations (0.2.22): every other principal is refused.
    if (invocation.actorId !== ownerId) return denied();
    const canReadCode = await deps.codeRights.canReadCode({ storageScopeId: binding.storageScopeId,
      repoId: binding.repoId, actorId: invocation.actorId });
    const target = { storageScopeId: binding.storageScopeId, repoId: binding.repoId, branch: binding.branch,
      subPath: binding.subPath, principalId: invocation.actorId, outputDir: IMMO_GIT_OUTPUT_DIR };
    const portRepository = { storageScopeId: repository.storageScopeId, repoId: repository.repoId, locator: repository.locator,
      installationRef: repository.installationRef, branchPrefix: repository.branchPrefix, allowedSubPaths: repository.allowedSubPaths,
      canWrite: repository.canWrite, writablePaths: repository.writablePaths, refusedWritePaths: repository.refusedWritePaths };
    return { binding, ownerId, canReadCode, repository: portRepository, target, invited: false,
      canWrite: canReadCode && repository.canWrite && deps.hasWriteScope(),
      humanLinked: await deps.directory.resolve({ storageScopeId: binding.storageScopeId, principalId: invocation.actorId }) !== null,
      qualified: deps.qualified() };
  };
}

export type LiveReaderRole = { readonly role: "binding_owner"; readonly principalId: string; readonly bindingGeneration: number };

/**
 * Content-host live reader gate (A-LIVE §8.2), owner-only: the binding owner
 * with current code rights. Null refuses (every invitee until 0.2.22).
 */
export function createLiveReaderGate(deps: Pick<LiveAuthorityDeps, "bindings" | "registry" | "codeRights">) {
  return async (storageScopeId: string, artifactId: string, principalId: string): Promise<LiveReaderRole | null> => {
    let context;
    try { context = await bindingContext(deps, storageScopeId, artifactId); } catch { return null; }
    const { binding, ownerId } = context;
    // TODO(0.2.22): invitee path through liveViewer(identity, principalId).
    if (principalId !== ownerId) return null;
    if (!await deps.codeRights.canReadCode({ storageScopeId, repoId: binding.repoId, actorId: principalId })) return null;
    return { role: "binding_owner", principalId, bindingGeneration: binding.generation };
  };
}
