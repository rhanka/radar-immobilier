/**
 * Grant renewal and revocation (ARTEFACTS A6/H5).
 *
 * Renewal rereads current approval, ACL and policy: any regression fails
 * closed and the old grant is not extended. Revocation lists session ids.
 * Stream integration must call the access predicate; no stream is served here.
 */
import { performance } from "node:perf_hooks";
import type { AuthorityReader } from "./reader-profile.js";
import { mintGrant, verifyGrant, type GrantClaims, type GrantIssuer } from "./preview-grant.js";

export interface RenewalDeps {
  readonly authority: AuthorityReader;
  readonly secret: string;
  readonly issuer: GrantIssuer;
  readonly now?: () => number;
}

export function createRevocationList(): {
  revoke: (sessionId: string) => void;
  isRevoked: (sessionId: string) => boolean;
} {
  const revoked = new Set<string>();
  return {
    revoke: (sessionId) => {
      revoked.add(sessionId);
    },
    isRevoked: (sessionId) => revoked.has(sessionId),
  };
}

export async function renewGrant(
  presented: string,
  deps: RenewalDeps,
  isRevoked: (sessionId: string) => boolean,
  nowMs: number,
): Promise<string | null> {
  const startedAt = performance.now();
  const now = deps.now ?? (() => nowMs + performance.now() - startedAt);
  try {
  const verified = await verifyGrant(presented, deps.issuer, deps.secret, now());
  if (!verified) return null;
  if (isRevoked(verified.sessionId)) return null;
  const rights = await deps.authority.getRights(verified.readerSub);
  if (!rights || !rights.approved || rights.readerSub !== verified.readerSub) return null;
  if (!rights.capabilities.includes("geo.read") && !rights.capabilities.includes("signals.protected-read")) return null;
  const profile = await deps.authority.getProfile(verified.artifactId);
  if (!profile || profile.name !== verified.profileName) return null;
  if (profile.policyRevision !== verified.policyRevision) return null;
  const release = await deps.authority.getRelease(verified.artifactId);
  if (!release || release.artifactId !== verified.artifactId || release.releaseId !== verified.releaseId) return null;
  const issuedAt = now();
  if (issuedAt >= verified.expiresAtMs || isRevoked(verified.sessionId)) return null;
  const next: GrantClaims = { ...deps.issuer, ...verified };
  const renewed = await mintGrant(next, deps.secret, issuedAt);
  return now() < verified.expiresAtMs && !isRevoked(verified.sessionId) ? renewed : null;
  } catch { return null; }
}

/** Fail-closed access predicate shared by page serving and stream chunks. */
export function accessOpen(options: {
  grantValid: boolean;
  revoked: boolean;
  outage: boolean;
}): boolean {
  return options.grantValid && !options.revoked && !options.outage;
}
