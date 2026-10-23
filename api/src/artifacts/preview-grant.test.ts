import { describe, expect, it } from "vitest";
import {
  mintGrant,
  PREVIEW_ACCESS_CUTOFF_MS,
  PREVIEW_GRANT_SKEW_BUDGET_MS,
  verifyGrant,
  type GrantClaims,
} from "./preview-grant.js";

const SECRET = "grant-secret-32-bytes-long-padding!";
const GRANT: GrantClaims = {
  issuer: "https://api.example.test",
  audience: "https://api.example.test/reader",
  tier: "preprod",
  host: "artifact.pages.example.test",
  artifactId: "123e4567-e89b-12d3-a456-426614174000",
  releaseId: "123e4567-e89b-12d3-a456-426614174001",
  readerSub: "reader-alice",
  sessionId: "session-1",
  profileName: "demo",
  policyRevision: "pol-001",
};

describe("preview grants", () => {
  it("should verify a grant inside its lifetime", async () => {
    const token = await mintGrant(GRANT, SECRET, 1_000);
    expect(await verifyGrant(token, GRANT, SECRET, 20_000)).not.toBeNull();
  });

  it("should refuse forged, expired and cross-bound grants", async () => {
    const token = await mintGrant(GRANT, SECRET, 1_000);
    expect(await verifyGrant(`${token}x`, GRANT, SECRET, 2_000)).toBeNull();
    expect(await verifyGrant(token, GRANT, SECRET, 61_000)).toBeNull();
    expect(await verifyGrant(token, { ...GRANT, readerSub: "reader-bob" }, SECRET, 2_000)).toBeNull();
    expect(await verifyGrant(token, { ...GRANT, releaseId: "release-002" }, SECRET, 2_000)).toBeNull();
    expect(await verifyGrant(token, { ...GRANT, host: "other.pages.example.test" }, SECRET, 2_000)).toBeNull();
    expect(await verifyGrant(token, { ...GRANT, policyRevision: "pol-002" }, SECRET, 2_000)).toBeNull();
  });

  it("should keep the 55 s grant inside the 60 s cutoff with the skew budget", () => {
    expect(55_000 + PREVIEW_GRANT_SKEW_BUDGET_MS).toBeLessThanOrEqual(PREVIEW_ACCESS_CUTOFF_MS);
  });
});
