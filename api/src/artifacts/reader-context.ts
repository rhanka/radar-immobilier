/**
 * Reader-context adaptation (ARTEFACTS A6/H5).
 *
 * Adapts a verified H5 grant to the verified API reader context, separately
 * from H4's delegated search token. Effective rights are the intersection of
 * the artifact profile, the reader's current rights and the receiving API's
 * own checks. Fixed Geo/Radar routing: no Radar Bearer [REDACTED] Geo.
 */
import type { GrantClaims } from "./preview-grant.js";
import {
  intersectCapabilities,
  type AuthorityReader,
  type ReaderCapability,
} from "./reader-profile.js";

export interface ApiReaderContext {
  readonly readerSub: string;
  readonly sessionId: string;
  readonly artifactId: string;
  readonly releaseId: string;
  readonly profileName: string;
  readonly policyRevision: string;
  readonly capabilities: readonly ReaderCapability[];
  readonly source: "h5-grant";
}

export async function adaptGrantToReader(
  grant: GrantClaims,
  authority: AuthorityReader,
): Promise<ApiReaderContext | null> {
  const release = await authority.getRelease(grant.artifactId);
  if (!release || release.artifactId !== grant.artifactId || release.releaseId !== grant.releaseId) return null;
  const profile = await authority.getProfile(grant.artifactId);
  if (!profile || profile.name !== grant.profileName) return null;
  if (profile.policyRevision !== grant.policyRevision) return null;
  const rights = await authority.getRights(grant.readerSub);
  if (!rights || !rights.approved || rights.readerSub !== grant.readerSub) return null;
  return {
    readerSub: grant.readerSub,
    sessionId: grant.sessionId,
    artifactId: grant.artifactId,
    releaseId: grant.releaseId,
    profileName: profile.name,
    policyRevision: profile.policyRevision,
    capabilities: intersectCapabilities(profile, rights),
    source: "h5-grant",
  };
}

export function canInvoke(
  context: ApiReaderContext,
  capability: ReaderCapability,
  releaseId: string,
): boolean {
  return context.releaseId === releaseId && context.capabilities.includes(capability);
}

/** Fixed upstream routing table: content never supplies a URL. */
const FIXED_ROUTES = {
  geo: "https://geo.example.test",
  radar: "https://api.example.test",
} as const;

export function fixedUpstream(kind: "geo" | "radar"): string {
  return FIXED_ROUTES[kind];
}
