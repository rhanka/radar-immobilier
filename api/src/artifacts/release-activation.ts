/**
 * Release activation registry (ARTEFACTS A6/H5).
 *
 * Tracks the active release and policy revision per artifact. Grants carry
 * an explicit release context: an old tab keeps serving its pinned release
 * but never gains a newer profile. Activation rereads the authority seam so
 * fixture-only success cannot promote an unapproved release in production.
 */
import type { AuthorityReader } from "./reader-profile.js";

export interface ActiveRelease {
  readonly artifactId: string;
  readonly releaseId: string;
  readonly profileName: string;
  readonly policyRevision: string;
  readonly activatedAt: number;
}

export function createActivationRegistry(options: { now?: () => number } = {}): {
  activate: (artifactId: string, releaseId: string, authority: AuthorityReader) => Promise<ActiveRelease | null>;
  active: (artifactId: string) => ActiveRelease | null;
  matches: (artifactId: string, releaseId: string, policyRevision: string) => boolean;
  canUpgrade: (artifactId: string, releaseId: string) => boolean;
} {
  const now = options.now ?? (() => Date.now());
  const active = new Map<string, ActiveRelease>();

  return {
    async activate(artifactId, releaseId, authority) {
      const previous = active.get(artifactId);
      const version = await authority.getAuthorizationVersion(artifactId);
      if (!version) return null;
      const release = await authority.getRelease(artifactId);
      if (!release || release.artifactId !== artifactId || release.releaseId !== releaseId) return null;
      const profile = await authority.getProfile(artifactId);
      if (!profile) return null;
      // Revalidate: a concurrent activation may have moved the authority on.
      // A stale activation never overwrites the current record.
      const freshRelease = await authority.getRelease(artifactId);
      if (!freshRelease || freshRelease.artifactId !== artifactId || freshRelease.releaseId !== releaseId) return null;
      const freshProfile = await authority.getProfile(artifactId);
      if (!freshProfile || freshProfile.name !== profile.name) return null;
      if (freshProfile.policyRevision !== profile.policyRevision) return null;
      const record: ActiveRelease = {
        artifactId,
        releaseId,
        profileName: freshProfile.name,
        policyRevision: freshProfile.policyRevision,
        activatedAt: now(),
      };
      // Confirm the authority still points at this release before writing.
      const current = await authority.getRelease(artifactId);
      if (!current || current.artifactId !== artifactId || current.releaseId !== releaseId) return null;
      if (await authority.getAuthorizationVersion(artifactId) !== version) return null;
      if (active.get(artifactId) !== previous) return null;
      active.set(artifactId, record);
      return record;
    },
    active: (artifactId) => active.get(artifactId) ?? null,
    matches: (artifactId, releaseId, policyRevision) => {
      const record = active.get(artifactId);
      return record?.releaseId === releaseId && record.policyRevision === policyRevision;
    },
    canUpgrade: (artifactId, releaseId) => {
      const record = active.get(artifactId);
      return record !== undefined && record.releaseId !== releaseId;
    },
  };
}
