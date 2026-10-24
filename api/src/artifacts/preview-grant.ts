/**
 * Signed reader grants (ARTEFACTS A6/H5).
 *
 * HS256 JWT bound to issuer/audience/tier/host/artifact/release/reader/
 * session/profile/policy-revision/profile-fingerprint/expiry. Proposed lifetime is 55 seconds;
 * with the <= 5 s propagation/skew budget the measured cutoff stays <= 60 s.
 * Forged, expired or cross-bound grants fail closed.
 */
import { SignJWT, jwtVerify } from "jose";

export const PREVIEW_GRANT_TTL_SECONDS = 55;
export const PREVIEW_GRANT_SKEW_BUDGET_MS = 5_000;
export const PREVIEW_ACCESS_CUTOFF_MS = 60_000;

export interface GrantIssuer {
  readonly issuer: string;
  readonly audience: string;
  readonly tier: string;
}

export interface GrantSubject {
  readonly host: string;
  readonly artifactId: string;
  readonly releaseId: string;
  readonly readerSub: string;
  readonly sessionId: string;
  readonly profileName: string;
  readonly policyRevision: string;
  readonly profileFingerprint: string;
}

export type GrantClaims = GrantIssuer & GrantSubject;
export type VerifiedGrant = GrantClaims & { readonly expiresAtMs: number };

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function mintGrant(
  grant: GrantClaims,
  secret: string,
  nowMs: number,
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  const token = await new SignJWT({ ...grant })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(grant.issuer)
    .setAudience(grant.audience)
    .setIssuedAt(issuedAt)
    .setSubject(grant.readerSub)
    .setExpirationTime(issuedAt + PREVIEW_GRANT_TTL_SECONDS)
    .sign(secretKey(secret));
  if (Buffer.byteLength(token) > 4096) throw new Error("Reader grant exceeds header budget");
  return token;
}

export async function verifyGrant(
  token: string,
  expected: GrantIssuer & Partial<GrantSubject>,
  secret: string,
  nowMs: number,
): Promise<VerifiedGrant | null> {
  try {
    if (token.length > 4096) return null;
    const { payload } = await jwtVerify(token, secretKey(secret), {
      algorithms: ["HS256"],
      issuer: expected.issuer,
      audience: expected.audience,
      currentDate: new Date(nowMs),
      requiredClaims: ["exp", "iat", "sub"],
      maxTokenAge: PREVIEW_GRANT_TTL_SECONDS,
    });
    const claims = payload as unknown as Record<string, unknown>;
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number" ||
      payload.exp <= payload.iat || payload.exp - payload.iat > PREVIEW_GRANT_TTL_SECONDS ||
      payload.sub !== claims.readerSub) return null;
    const fields = ["tier", "host", "artifactId", "releaseId", "readerSub", "sessionId", "profileName", "policyRevision", "profileFingerprint"] as const;
    for (const field of fields) {
      const want = expected[field];
      if (want !== undefined && claims[field] !== want) return null;
    }
    for (const field of fields) {
      if (typeof claims[field] !== "string") return null;
    }
    return {
      expiresAtMs: payload.exp * 1000,
      issuer: expected.issuer ?? "",
      audience: expected.audience ?? "",
      tier: claims.tier as string,
      host: claims.host as string,
      artifactId: claims.artifactId as string,
      releaseId: claims.releaseId as string,
      readerSub: claims.readerSub as string,
      sessionId: claims.sessionId as string,
      profileName: claims.profileName as string,
      policyRevision: claims.policyRevision as string,
      profileFingerprint: claims.profileFingerprint as string,
    };
  } catch {
    return null;
  }
}
