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
      const release = await authority.getRelease(artifactId);
      if (!release || release.releaseId !== releaseId) return null;
      const profile = await authority.getProfile(artifactId);
      if (!profile) return null;
      const record: ActiveRelease = {
        artifactId,
        releaseId,
        profileName: profile.name,
        policyRevision: profile.policyRevision,
        activatedAt: now(),
      };
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
