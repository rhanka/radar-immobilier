import { describe, expect, it } from "vitest";
import { createFixtureAuthority } from "./reader-profile.js";
import { mintGrant } from "./preview-grant.js";
import { renewGrant } from "./preview-renewal.js";

const secret = "grant-secret-32-bytes-long-padding!";
const issuer = { issuer: "https://api.example.test", audience: "https://api.example.test/reader", tier: "preprod" };
const claims = { ...issuer, host: "artifact.pages.example.test",
  artifactId: "123e4567-e89b-12d3-a456-426614174000",
  releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice",
  sessionId: "session-1", profileName: "demo", policyRevision: "pol-001" };

describe("renewal after authority waits", () => {
  it.each(["expiry", "revocation"])("should refuse renewal after %s during the authority wait", async reason => {
    let now = 1_000;
    let revoked = false;
    const fixture = createFixtureAuthority();
    const authority = { ...fixture, getRelease: async (artifactId: string) => {
      await Promise.resolve();
      if (reason === "expiry") now = 56_000;
      else revoked = true;
      return fixture.getRelease(artifactId);
    } };
    const deps = { authority, secret, issuer, now: () => now };
    const token = await mintGrant(claims, secret, now);
    expect(await renewGrant(token, deps, () => revoked, now)).toBeNull();
  });
});
