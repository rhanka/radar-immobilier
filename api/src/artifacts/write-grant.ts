/**
 * PW-A write grant: class write, audience radar-artifact-write, 120 s window.
 * Read grants stay unchanged; this issuer binds the H5 page session (P)
 * and the identity issuer of the originating domain. No wildcards.
 */
import { SignJWT, jwtVerify } from "jose";
import { WRITE_GRANT_AUDIENCE, WRITE_GRANT_TTL_SECONDS, WRITE_PROFILE_NAME } from "./write-profile.js";
import { assertWriteOperationsClosed } from "./write-profile.js";

export interface WriteGrantIssuer {
  readonly issuer: string;
  readonly audience: string;
  readonly tier: string;
}

export interface WriteGrantClaims extends WriteGrantIssuer {
  readonly jti: string;
  readonly sessionId: string;
  readonly sub: string;
  readonly readerSub: string;
  readonly identityIssuer: string;
  readonly artifactId: string;
  readonly releaseId: string;
  readonly host: string;
  readonly profileName: string;
  readonly profileFingerprint: string;
  readonly policyRevision: string;
  readonly workspaceId: string;
  readonly citySlug: string;
  readonly operations: readonly string[];
}

export type VerifiedWriteGrant = WriteGrantClaims & { readonly expiresAtMs: number };

function keyBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Mint a 120 s write grant; rejects wildcards and read profiles. */
export async function mintWriteGrant(grant: WriteGrantClaims, secret: string, nowMs: number,
  authorityExpiresAtMs = nowMs + WRITE_GRANT_TTL_SECONDS * 1000): Promise<string> {
  if (Buffer.byteLength(secret) < 32) throw new Error("write_grant_key_unavailable");
  if (grant.audience !== WRITE_GRANT_AUDIENCE) throw new Error("write_grant_audience_mismatch");
  if (grant.profileName !== WRITE_PROFILE_NAME) throw new Error("write_grant_profile_mismatch");
  if (grant.sub !== grant.readerSub) throw new Error("write_grant_subject_mismatch");
  if (grant.sessionId.length === 0 || grant.identityIssuer.length === 0) {
    throw new Error("write_grant_binding_missing");
  }
  assertWriteOperationsClosed([...grant.operations]);
  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = Math.min(issuedAt + WRITE_GRANT_TTL_SECONDS,
    Math.floor(authorityExpiresAtMs / 1000));
  if (expiresAt <= issuedAt) throw new Error("write_grant_expired");
  const token = await new SignJWT({ ...grant, grantKind: "write", permitsWrites: true })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(grant.issuer)
    .setAudience(grant.audience)
    .setJti(grant.jti)
    .setSubject(grant.readerSub)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(keyBytes(secret));
  if (Buffer.byteLength(token) > 4096) throw new Error("write grant exceeds header budget");
  return token;
}

/** Verify class, audience, tier, subject binding, profile, and 120 s window. */
export async function verifyWriteGrant(
  token: string,
  expected: WriteGrantIssuer & Partial<WriteGrantClaims>,
  secret: string,
  nowMs: number,
): Promise<VerifiedWriteGrant | null> {
  try {
    if (Buffer.byteLength(secret) < 32) return null;
    if (expected.audience !== WRITE_GRANT_AUDIENCE) return null;
    if (token.length === 0 || token.length > 4096) return null;
    const { payload } = await jwtVerify(token, keyBytes(secret), {
      algorithms: ["HS256"],
      issuer: expected.issuer,
      audience: expected.audience ?? WRITE_GRANT_AUDIENCE,
      currentDate: new Date(nowMs),
      requiredClaims: ["exp", "iat", "sub", "jti"],
      maxTokenAge: WRITE_GRANT_TTL_SECONDS,
    });
    const claims = payload as unknown as Record<string, unknown>;
    if (payload.aud !== WRITE_GRANT_AUDIENCE) return null;
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number"
      || payload.exp <= payload.iat
      || payload.exp - payload.iat > WRITE_GRANT_TTL_SECONDS
      || payload.sub !== claims.readerSub) return null;
    if (claims.grantKind !== "write" || claims.permitsWrites !== true
      || claims.profileName !== WRITE_PROFILE_NAME) return null;
    const fields = ["tier", "host", "artifactId", "releaseId", "readerSub", "sessionId",
      "identityIssuer", "profileFingerprint", "policyRevision", "workspaceId", "citySlug", "jti"] as const;
    for (const field of fields) {
      const want = expected[field];
      if (want !== undefined && claims[field] !== want) return null;
      if (typeof claims[field] !== "string" || (claims[field] as string).length === 0) return null;
    }
    if (!Array.isArray(claims.operations)) return null;
    if (expected.operations && [...expected.operations].sort().join(",")
      !== [...claims.operations].sort().join(",")) return null;
    try {
      assertWriteOperationsClosed(claims.operations as string[]);
    } catch {
      return null;
    }
    return {
      issuer: expected.issuer ?? "",
      audience: WRITE_GRANT_AUDIENCE,
      tier: claims.tier as string,
      jti: claims.jti as string,
      sessionId: claims.sessionId as string,
      sub: claims.sub as string,
      readerSub: claims.readerSub as string,
      identityIssuer: claims.identityIssuer as string,
      artifactId: claims.artifactId as string,
      releaseId: claims.releaseId as string,
      host: claims.host as string,
      profileName: claims.profileName as string,
      profileFingerprint: claims.profileFingerprint as string,
      policyRevision: claims.policyRevision as string,
      workspaceId: claims.workspaceId as string,
      citySlug: claims.citySlug as string,
      operations: [...(claims.operations as string[])],
      expiresAtMs: (payload.exp as number) * 1000,
    };
  } catch {
    return null;
  }
}
