import { describe, expect, it } from "vitest";
import { createFixtureAuthority } from "./reader-profile.js";
import { mintGrant, type GrantClaims } from "./preview-grant.js";
import { accessOpen, createRevocationList, renewGrant } from "./preview-renewal.js";

const SECRET = "grant-secret-32-bytes-long-padding!";
const ISSUER = { issuer: "https://api.example.test", audience: "https://api.example.test/reader", tier: "preprod" };
const GRANT: GrantClaims = {
  ...ISSUER,
  host: "artifact.pages.example.test",
  artifactId: "123e4567-e89b-12d3-a456-426614174000",
  releaseId: "123e4567-e89b-12d3-a456-426614174001",
  readerSub: "reader-alice",
  sessionId: "session-1",
  profileName: "demo",
  policyRevision: "pol-001",
};

describe("grant renewal and revocation", () => {
  it("should renew a healthy grant", async () => {
    const token = await mintGrant(GRANT, SECRET, 1_000);
    const renewed = await renewGrant(
      token,
      { authority: createFixtureAuthority(), secret: SECRET, issuer: ISSUER },
      () => false,
      10_000,
    );
    expect(renewed).not.toBeNull();
  });

  it("should refuse renewal for revoked sessions and unapproved readers", async () => {
    const revoked = createRevocationList();
    revoked.revoke("session-1");
    const token = await mintGrant(GRANT, SECRET, 1_000);
    expect(await renewGrant(
      token,
      { authority: createFixtureAuthority(), secret: SECRET, issuer: ISSUER },
      revoked.isRevoked,
      10_000,
    )).toBeNull();
    const mallory = await mintGrant({ ...GRANT, readerSub: "reader-mallory" }, SECRET, 1_000);
    expect(await renewGrant(
      mallory,
      { authority: createFixtureAuthority(), secret: SECRET, issuer: ISSUER },
      () => false,
      10_000,
    )).toBeNull();
  });

  it("should close access at expiry, on revocation and on outage", () => {
    expect(accessOpen({ grantValid: true, revoked: false, outage: false })).toBe(true);
    expect(accessOpen({ grantValid: false, revoked: false, outage: false })).toBe(false);
    expect(accessOpen({ grantValid: true, revoked: true, outage: false })).toBe(false);
    expect(accessOpen({ grantValid: true, revoked: false, outage: true })).toBe(false);
  });
});
