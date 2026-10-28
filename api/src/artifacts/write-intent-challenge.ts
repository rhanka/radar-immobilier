/**
 * PW-A single-use challenge token: HMAC-bound, application-only.
 * The token is served solely with the authenticated application summary;
 * prepare, polling, URLs, and logs never carry it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface ChallengeMaterial {
  challengeId: string;
  intentDigest: string;
  expiresAtMs: number;
  keyId: string;
}

const HEX64 = /^[a-f0-9]{64}$/;

function canonicalChallenge(material: ChallengeMaterial): string {
  return JSON.stringify(["pw-confirm-v1", material.challengeId,
    material.intentDigest, material.expiresAtMs, material.keyId]);
}

/** Issue the opaque confirm token for one prepared intent. */
export function issueWriteChallengeToken(material: ChallengeMaterial, secret: Uint8Array): string {
  if (!HEX64.test(material.challengeId) || !HEX64.test(material.intentDigest)
    || !Number.isSafeInteger(material.expiresAtMs) || material.keyId.length === 0) {
    throw new Error("challenge_material_invalid");
  }
  const mac = createHmac("sha256", secret).update(canonicalChallenge(material), "utf8").digest("hex");
  const payload = Buffer.from(JSON.stringify({
    v: 1, challengeId: material.challengeId, intentDigest: material.intentDigest,
    expiresAtMs: material.expiresAtMs, keyId: material.keyId,
  }), "utf8").toString("base64url");
  const token = `${payload}.${mac}`;
  if (token.length > 512) throw new Error("challenge token exceeds body budget");
  return token;
}

/** Verify format, MAC, and binding; expiry stays with the admission window. */
export function verifyWriteChallengeToken(
  token: string,
  expected: ChallengeMaterial,
  secret: Uint8Array,
): boolean {
  try {
    if (typeof token !== "string" || token.length === 0 || token.length > 512) return false;
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return false;
    const payloadText = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    if (payload.v !== 1 || payload.challengeId !== expected.challengeId
      || payload.intentDigest !== expected.intentDigest
      || payload.expiresAtMs !== expected.expiresAtMs
      || payload.keyId !== expected.keyId) return false;
    const mac = createHmac("sha256", secret).update(canonicalChallenge(expected), "utf8").digest("hex");
    const seen = token.slice(dot + 1);
    if (seen.length !== mac.length) return false;
    return timingSafeEqual(Buffer.from(seen, "utf8"), Buffer.from(mac, "utf8"));
  } catch {
    return false;
  }
}
