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

  it("should refuse renewal when per-artifact approval is withdrawn", async () => {
    const token = await mintGrant(GRANT, SECRET, 1_000);
    const base = createFixtureAuthority();
    const revoked = { ...base,
      getRights: async (readerSub: string, artifactId: string) =>
        artifactId === GRANT.artifactId ? null : base.getRights(readerSub, artifactId) };
    expect(await renewGrant(
      token,
      { authority: revoked, secret: SECRET, issuer: ISSUER },
      () => false,
      10_000,
    )).toBeNull();
    const other = "223e4567-e89b-12d3-a456-426614174000";
    const siblingGrant = await mintGrant({ ...GRANT, artifactId: other }, SECRET, 1_000);
    const sibling = { ...base,
      getAuthorizationVersion: async (artifactId: string) => artifactId === other
        ? "sibling-v1" : base.getAuthorizationVersion(artifactId),
      getRelease: async (artifactId: string) => artifactId === other
        ? { artifactId: other, releaseId: GRANT.releaseId, authorSub: "author-alice" }
        : base.getRelease(artifactId),
      getProfile: async (artifactId: string) => artifactId === other
        ? { name: "demo", policyRevision: "pol-001", capabilities: ["geo.read" as const] }
        : base.getProfile(artifactId),
      getRights: async (readerSub: string, artifactId: string) => artifactId === other
        ? { readerSub, artifactId, approved: true, capabilities: ["geo.read" as const] }
        : null };
    expect(await renewGrant(
      siblingGrant,
      { authority: sibling, secret: SECRET, issuer: ISSUER },
      () => false,
      10_000,
    )).not.toBeNull();
  });

  it("should renew page access for approved readers without API capabilities", async () => {
    const token = await mintGrant(GRANT, SECRET, 1_000);
    const base = createFixtureAuthority();
    const noCaps = { ...base,
      getRights: async (readerSub: string, artifactId: string) => ({
        readerSub, artifactId, approved: true, capabilities: [] as const }) };
    const renewed = await renewGrant(
      token,
      { authority: noCaps, secret: SECRET, issuer: ISSUER },
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
