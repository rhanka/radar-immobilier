import type { GitBindingStore, GitCodeRightsPort, GitHumanDirectory, GitRepositoryRegistry, LiveAuthority, LiveIdentity, LiveInvocation,
  LiveViewer } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { IMMO_GIT_OUTPUT_DIR } from "./registry.js";

/**
 * Live authority and the content-host reader gate (M4-I, Δ4). OWNER-ONLY
 * unless the generic invitations are qualified (IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED).
 *
 * - Each user edits THEIR OWN personal binding: the binding owner is the
 *   acting user (`personalPrincipalId`), never a platform owner. Writes need
 *   current code rights, the host write scope and a GitHub linkage.
 * - Anyone else, including other code-rights holders, is refused
 *   (`access_denied`); a different principal never writes to someone else's
 *   binding (co-editing would be a contract change).
 *
 * Invited live readers are GENERIC in @sentropic/artifacts 0.2.22
 * (artifacts_live_invite / _accept_invitation / _revoke_invitation /
 * _invitations, package migration 0013_live_invitations). The immo invitation
 * store of #1030 (migration 0038) was dropped by migration 0041 so the package
 * migration (0042) creates its own table. The package `liveViewer(identity,
 * principalId)` decides who is an accepted invitee; the package only lets an
 * active invitee do `live_read` (viewing only: no write, publish or release).
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
  /**
   * Invitation views of the package live service. Absent, or `qualified()`
   * false: live stays owner-only (every other principal is refused).
   */
  readonly invitations?: LiveInvitationViews | undefined;
}

/** The package `liveViewer` behind the invitations qualification flag. */
export interface LiveInvitationViews {
  readonly qualified: () => boolean;
  readonly viewer: (identity: LiveIdentity, principalId: string) => Promise<LiveViewer>;
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
    // Owner-only unless the generic invitations are qualified: every other principal is refused.
    const owner = invocation.actorId === ownerId;
    let invited = false;
    if (!owner) {
      if (!deps.invitations?.qualified()) return denied();
      // A non-owner is admitted to the package operations only (accept, own invitations, live_read as an
      // ACTIVE invitee); the package refuses every owner-only operation on `ownerId`.
      const viewer = await deps.invitations.viewer({ storageScopeId: binding.storageScopeId, artifactId,
        bindingGeneration: binding.generation }, invocation.actorId);
      invited = viewer?.role === "invitee";
    }
    const canReadCode = await deps.codeRights.canReadCode({ storageScopeId: binding.storageScopeId,
      repoId: binding.repoId, actorId: invocation.actorId });
    const target = { storageScopeId: binding.storageScopeId, repoId: binding.repoId, branch: binding.branch,
      subPath: binding.subPath, principalId: invocation.actorId, outputDir: IMMO_GIT_OUTPUT_DIR };
    const portRepository = { storageScopeId: repository.storageScopeId, repoId: repository.repoId, locator: repository.locator,
      installationRef: repository.installationRef, branchPrefix: repository.branchPrefix, allowedSubPaths: repository.allowedSubPaths,
      canWrite: repository.canWrite, writablePaths: repository.writablePaths, refusedWritePaths: repository.refusedWritePaths };
    return { binding, ownerId, canReadCode, repository: portRepository, target, invited,
      canWrite: owner && canReadCode && repository.canWrite && deps.hasWriteScope(),
      humanLinked: await deps.directory.resolve({ storageScopeId: binding.storageScopeId, principalId: invocation.actorId }) !== null,
      qualified: deps.qualified() };
  };
}

export type LiveReaderRole =
  | { readonly role: "binding_owner"; readonly principalId: string; readonly bindingGeneration: number }
  | { readonly role: "invitee"; readonly principalId: string; readonly bindingGeneration: number;
    /** Accepted invitation (expiresAt in ms) from the package `liveViewer`. */
    readonly invitation: { readonly id: string; readonly epoch: number; readonly expiresAt: number } };

/**
 * Content-host live reader gate (A-LIVE §8.2): the binding owner with current
 * code rights, or, when the invitations are qualified, an invitee holding an
 * ACTIVE accepted invitation (package `liveViewer`) and current code rights.
 * Null refuses. `viewer` absent (not qualified): owner-only, unchanged.
 */
export function createLiveReaderGate(deps: Pick<LiveAuthorityDeps, "bindings" | "registry" | "codeRights"> & {
  readonly viewer?: LiveInvitationViews["viewer"] | undefined }) {
  return async (storageScopeId: string, artifactId: string, principalId: string): Promise<LiveReaderRole | null> => {
    let context;
    try { context = await bindingContext(deps, storageScopeId, artifactId); } catch { return null; }
    const { binding, ownerId } = context;
    if (!await deps.codeRights.canReadCode({ storageScopeId, repoId: binding.repoId, actorId: principalId })) return null;
    if (principalId === ownerId) return { role: "binding_owner", principalId, bindingGeneration: binding.generation };
    if (!deps.viewer) return null;
    let viewer: LiveViewer;
    try {
      viewer = await deps.viewer({ storageScopeId, artifactId, bindingGeneration: binding.generation }, principalId);
    } catch { return null; }
    return viewer?.role === "invitee"
      ? { role: "invitee", principalId, bindingGeneration: binding.generation, invitation: viewer.invitation } : null;
  };
}
