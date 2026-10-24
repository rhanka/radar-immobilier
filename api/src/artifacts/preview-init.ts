/**
 * Browser-bound preview init (ARTEFACTS A6/H5).
 *
 * Validates the exact origin, artifact, release, profile and normalized
 * return target before any ticket is minted. Returns the trust-page summary
 * (author/release/requested capabilities) the browser shows for approval.
 * No ticket, session or grant is created here.
 */
import type { AuthorityReader } from "./reader-profile.js";

export interface PreviewInitRequest {
  readonly origin: string;
  readonly artifactId: string;
  readonly releaseId: string;
  readonly profileName: string;
  readonly returnTarget: string;
}

export interface PreviewInitSummary {
  readonly origin: string;
  readonly artifactId: string;
  readonly releaseId: string;
  readonly authorSub: string;
  readonly profileName: string;
  readonly policyRevision: string;
  readonly capabilities: readonly string[];
  readonly returnTarget: string;
}

const ARTIFACT_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const RELEASE_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function normalizeOrigin(origin: string): string | null {
  const trimmed = origin.trim();
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:[0-9]{1,5})?$/.test(trimmed)) return null;
  if (trimmed.endsWith(".")) return null;
  return trimmed;
}

function normalizeReturnTarget(target: string, origin: string): string | null {
  const trimmed = target.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("//")) return null;
  if (trimmed.includes("\\") || trimmed.includes("\n") || trimmed.includes("\r")) return null;
  try {
    const resolved = new URL(trimmed, origin);
    if (resolved.origin !== origin) return null;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return null;
  }
}

export async function validatePreviewInit(
  input: PreviewInitRequest,
  authority: AuthorityReader,
): Promise<PreviewInitSummary | null> {
  const origin = normalizeOrigin(input.origin);
  if (origin === null) return null;
  if (origin !== await authority.getContentOrigin(input.artifactId)) return null;
  if (!ARTIFACT_RE.test(input.artifactId)) return null;
  if (!RELEASE_RE.test(input.releaseId)) return null;
  if (input.profileName.length === 0 || input.profileName.length > 64) return null;
  const release = await authority.getRelease(input.artifactId);
  if (release === null || release.releaseId !== input.releaseId) return null;
  const profile = await authority.getProfile(input.artifactId);
  if (profile === null || profile.name !== input.profileName) return null;
  const returnTarget = normalizeReturnTarget(input.returnTarget, origin);
  if (returnTarget === null) return null;
  return {
    origin,
    artifactId: input.artifactId,
    releaseId: input.releaseId,
    authorSub: release.authorSub,
    profileName: profile.name,
    policyRevision: profile.policyRevision,
    capabilities: [...profile.capabilities],
    returnTarget,
  };
}
