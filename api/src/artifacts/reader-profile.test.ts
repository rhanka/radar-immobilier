import { describe, expect, it } from "vitest";
import {
  createFixtureAuthority,
  fingerprintReaderProfile,
  intersectCapabilities,
} from "./reader-profile.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";

describe("reader-profile seam", () => {
  it("should intersect profile and reader capabilities", async () => {
    const authority = createFixtureAuthority();
    const profile = await authority.getProfile(ARTIFACT);
    const rights = await authority.getRights("reader-alice", ARTIFACT);
    expect(profile).not.toBeNull();
    expect(rights).not.toBeNull();
    expect(intersectCapabilities(profile!, rights!)).toEqual([
      "geo.read",
      "signals.protected-read",
    ]);
  });

  it("should report unapproved readers as not approved", async () => {
    const authority = createFixtureAuthority();
    expect((await authority.getRights("reader-mallory", ARTIFACT))?.approved).toBe(false);
    expect(await authority.getRelease("unknown-artifact")).toBeNull();
  });

  it("should scope approval to the requested artifact", async () => {
    const authority = createFixtureAuthority();
    expect(await authority.getRights("reader-alice", "unknown-artifact")).toBeNull();
  });

  it("should fingerprint the approved profile capabilities", async () => {
    const authority = createFixtureAuthority();
    const profile = (await authority.getProfile(ARTIFACT))!;
    expect(fingerprintReaderProfile(profile)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintReaderProfile({ ...profile, policyRevision: "pol-002" })).not.toBe(
      fingerprintReaderProfile(profile),
    );
    expect(fingerprintReaderProfile({ ...profile, capabilities: ["geo.read"] })).not.toBe(
      fingerprintReaderProfile(profile),
    );
  });
  it("should keep profile field boundaries and ignore capability order", () => {
    const profile = { name: "demo|policy", policyRevision: "revision", capabilities: ["geo.read" as const] };
    expect(fingerprintReaderProfile(profile)).not.toBe(fingerprintReaderProfile({
      ...profile, name: "demo", policyRevision: "policy|revision" }));
    const capabilities = ["geo.read", "signals.protected-read"] as const;
    expect(fingerprintReaderProfile({ ...profile, capabilities })).toBe(
      fingerprintReaderProfile({ ...profile, capabilities: [...capabilities].reverse() }));
  });
});
