// PW-A PWA-03: write grant class, audience, subject binding, 120 s window.
import { describe, expect, it } from "vitest";
import { mintWriteGrant, verifyWriteGrant, type WriteGrantClaims } from "./write-grant.js";
import { SignJWT } from "jose";

const SECRET = "write-grant-secret-32-bytes-long-pad!";
const BASE: WriteGrantClaims = {
  issuer: "https://h5.example.test",
  audience: "radar-artifact-write",
  tier: "preprod",
  jti: "33333333-3333-4333-8333-333333333333",
  sessionId: "page-session-1",
  sub: "reader-alice",
  readerSub: "reader-alice",
  identityIssuer: "https://auth.example.test",
  artifactId: "11111111-1111-4111-8111-111111111111",
  releaseId: "22222222-2222-4222-8222-222222222222",
  host: "artifact.pages.example.test",
  profileName: "h5-signal-write-v2",
  profileFingerprint: "c".repeat(64),
  policyRevision: "policy-1",
  workspaceId: "44444444-4444-4444-8444-444444444444",
  citySlug: "demo-town",
  operations: ["facets.signals.personal.select.v1"],
};

describe("write grants", () => {
  it("should verify inside the 120 s window with bound subject", async () => {
    const token = await mintWriteGrant(BASE, SECRET, 1_000);
    const verified = await verifyWriteGrant(token, BASE, SECRET, 60_000);
    expect(verified?.readerSub).toBe("reader-alice");
    expect(verified?.identityIssuer).toBe("https://auth.example.test");
  });

  it("should refuse independent class, P and identity bindings on otherwise valid signatures", async () => {
    const valid = { ...BASE, grantKind: "write", permitsWrites: true,
      iss: BASE.issuer, aud: BASE.audience, iat: 1, exp: 121 };
    for (const patch of [{ grantKind: "read" }, { sessionId: "other-P" },
      { identityIssuer: "https://other-idp.test" }, { profileFingerprint: "d".repeat(64) },
      { operations: ["facets.signals.personal.restore.v1"] }]) {
      const token = await new SignJWT({ ...valid, ...patch }).setProtectedHeader({ alg: "HS256" })
        .sign(new TextEncoder().encode(SECRET));
      expect(await verifyWriteGrant(token, BASE, SECRET, 2000)).toBeNull();
    }
    const limited = await mintWriteGrant(BASE, SECRET, 1000, 10_000);
    expect((await verifyWriteGrant(limited, BASE, SECRET, 2000))?.expiresAtMs).toBe(10_000);
    await expect(verifyWriteGrant(limited, BASE, SECRET, 10_000))
      .rejects.toMatchObject({ status: 401, message: "write_grant_expired" });
  });

  it("should refuse read profile, wildcard, split subject, and expiry", async () => {
    await expect(mintWriteGrant({ ...BASE, operations: ["*"] }, SECRET, 1_000)).rejects.toThrow();
    await expect(mintWriteGrant({ ...BASE, profileName: "demo" }, SECRET, 1_000)).rejects.toThrow();
    await expect(mintWriteGrant({ ...BASE, readerSub: "reader-bob" }, SECRET, 1_000)).rejects.toThrow();
    const token = await mintWriteGrant(BASE, SECRET, 1_000);
    await expect(verifyWriteGrant(token, BASE, SECRET, 121_000))
      .rejects.toMatchObject({ status: 401, message: "write_grant_expired" });
    expect(await verifyWriteGrant(`${token}x`, BASE, SECRET, 2_000)).toBeNull();
    expect(await verifyWriteGrant(token, { ...BASE, tier: "prod" }, SECRET, 2_000)).toBeNull();
  });

  it("should distinguish only authenticated and correctly bound grant expiration", async () => {
    const token = await mintWriteGrant(BASE, SECRET, 1000);
    await expect(verifyWriteGrant(token, BASE, SECRET, 121_000))
      .rejects.toMatchObject({ status: 401, message: "write_grant_expired" });
    expect(await verifyWriteGrant(`${token}x`, BASE, SECRET, 121_000)).toBeNull();
    expect(await verifyWriteGrant(token, { ...BASE, sessionId: "other" }, SECRET, 121_000)).toBeNull();
    const read = await new SignJWT({ ...BASE, grantKind: "read", permitsWrites: true,
      iss: BASE.issuer, aud: BASE.audience, iat: 1, exp: 121 })
      .setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(SECRET));
    expect(await verifyWriteGrant(read, BASE, SECRET, 121_000)).toBeNull();
  });
});
