/**
 * A6 integration: grant binding, release activation, renewal cutoff.
 * Synthetic clocks prove the <= 60 s access cutoff without waiting.
 */
import { describe, expect, it } from "vitest";
import { createFixtureAuthority } from "../../src/artifacts/reader-profile.js";
import {
  mintGrant,
  PREVIEW_ACCESS_CUTOFF_MS,
  verifyGrant,
  type GrantClaims,
} from "../../src/artifacts/preview-grant.js";
import { createActivationRegistry } from "../../src/artifacts/release-activation.js";
import { accessOpen, createRevocationList, renewGrant } from "../../src/artifacts/preview-renewal.js";

const SECRET = "grant-secret-32-bytes-long-padding!";
const ISSUER = { issuer: "https://api.example.test", audience: "https://api.example.test/reader", tier: "preprod" };
const GRANT: GrantClaims = {
  ...ISSUER,
  host: "123e4567-e89b-12d3-a456-426614174000.pages.example.test",
  artifactId: "123e4567-e89b-12d3-a456-426614174000",
  releaseId: "123e4567-e89b-12d3-a456-426614174001",
  readerSub: "reader-alice",
  sessionId: "session-1",
  profileName: "demo",
  policyRevision: "pol-001",
};

describe("artifacts reader grants and activation", () => {
  it("should bind grants and activate the matching release", async () => {
    const registry = createActivationRegistry({ now: () => 1_000 });
    const record = await registry.activate("123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174001", createFixtureAuthority());
    expect(record?.policyRevision).toBe("pol-001");
    const token = await mintGrant(GRANT, SECRET, 1_000);
    expect(await verifyGrant(token, GRANT, SECRET, 30_000)).not.toBeNull();
    expect(registry.matches("123e4567-e89b-12d3-a456-426614174000", GRANT.releaseId, GRANT.policyRevision)).toBe(true);
  });

  it("should cut access at expiry and on revocation", async () => {
    const token = await mintGrant(GRANT, SECRET, 1_000);
    expect(await verifyGrant(token, GRANT, SECRET, 1_000 + PREVIEW_ACCESS_CUTOFF_MS + 1)).toBeNull();
    const revoked = createRevocationList();
    revoked.revoke("session-1");
    expect(await renewGrant(
      token,
      { authority: createFixtureAuthority(), secret: SECRET, issuer: ISSUER },
      revoked.isRevoked,
      10_000,
    )).toBeNull();
    expect(accessOpen({ grantValid: true, revoked: true, outage: false })).toBe(false);
    expect(accessOpen({ grantValid: true, revoked: false, outage: true })).toBe(false);
  });

  it("should keep old tabs pinned without gaining a newer profile", async () => {
    const registry = createActivationRegistry({ now: () => 1_000 });
    await registry.activate("123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174001", createFixtureAuthority());
    const old = await mintGrant(GRANT, SECRET, 1_000);
    const verified = await verifyGrant(old, GRANT, SECRET, 10_000);
    expect(verified?.releaseId).toBe("123e4567-e89b-12d3-a456-426614174001");
    expect(registry.canUpgrade("123e4567-e89b-12d3-a456-426614174000", verified?.releaseId ?? "")).toBe(false);
    expect(registry.canUpgrade("123e4567-e89b-12d3-a456-426614174000", "release-002")).toBe(true);
  });
});
