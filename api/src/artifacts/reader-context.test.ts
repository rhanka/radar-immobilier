import { describe, expect, it } from "vitest";
import { createFixtureAuthority } from "./reader-profile.js";
import { adaptGrantToReader, canInvoke, fixedUpstream } from "./reader-context.js";
import type { GrantClaims } from "./preview-grant.js";

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

describe("reader-context adaptation", () => {
  it("should adapt a verified grant to an h5 reader context", async () => {
    const context = await adaptGrantToReader(GRANT, createFixtureAuthority());
    expect(context?.source).toBe("h5-grant");
    expect(context?.capabilities).toEqual(["geo.read", "signals.protected-read"]);
    expect(canInvoke(context!, "geo.read", "123e4567-e89b-12d3-a456-426614174001")).toBe(true);
    expect(canInvoke(context!, "geo.read", "release-002")).toBe(false);
  });

  it("should refuse unapproved readers and stale policy revisions", async () => {
    const authority = createFixtureAuthority();
    expect(await adaptGrantToReader({ ...GRANT, readerSub: "reader-mallory" }, authority)).toBeNull();
    expect(await adaptGrantToReader({ ...GRANT, policyRevision: "pol-999" }, authority)).toBeNull();
  });

  it("should refuse a revoked artifact while keeping a sibling accessible", async () => {
    const other = "223e4567-e89b-12d3-a456-426614174000";
    const seen: string[] = [];
    const base = createFixtureAuthority();
    const authority = { ...base,
      getRelease: async (artifactId: string) => artifactId === other
        ? { artifactId: other, releaseId: "release-sibling", authorSub: "author-alice" }
        : base.getRelease(artifactId),
      getProfile: async (artifactId: string) => artifactId === other
        ? { name: "demo", policyRevision: "pol-001", capabilities: ["geo.read" as const] }
        : base.getProfile(artifactId),
      getRights: async (readerSub: string, artifactId: string) => {
        seen.push(`${readerSub}|${artifactId}`);
        if (artifactId === GRANT.artifactId) return null;
        return { readerSub, artifactId, approved: true, capabilities: ["geo.read" as const] };
      } };
    expect(await adaptGrantToReader(GRANT, authority)).toBeNull();
    const sibling = await adaptGrantToReader(
      { ...GRANT, artifactId: other, releaseId: "release-sibling" }, authority);
    expect(sibling?.capabilities).toEqual(["geo.read"]);
    expect(seen).toContain(`reader-alice|${GRANT.artifactId}`);
    expect(seen).toContain(`reader-alice|${other}`);
  });

  it("should intersect profile and reader capabilities both ways", async () => {
    const base = createFixtureAuthority();
    const profileOnly = { ...base,
      getProfile: async () => ({ name: "demo", policyRevision: "pol-001",
        capabilities: ["geo.read" as const] }) };
    expect((await adaptGrantToReader(GRANT, profileOnly))?.capabilities).toEqual(["geo.read"]);
    const rightsOnly = { ...base,
      getRights: async (readerSub: string, artifactId: string) => ({
        readerSub, artifactId, approved: true, capabilities: ["geo.read" as const] }) };
    expect((await adaptGrantToReader(GRANT, rightsOnly))?.capabilities).toEqual(["geo.read"]);
  });

  it("should refuse an approval returned for a different artifact", async () => {
    const base = createFixtureAuthority();
    const authority = { ...base, getRights: async () => ({
      readerSub: GRANT.readerSub, artifactId: "another-artifact", approved: true,
      capabilities: ["geo.read" as const] }) };
    expect(await adaptGrantToReader(GRANT, authority)).toBeNull();
  });

  it("should route only to fixed upstreams", () => {
    expect(fixedUpstream("geo")).toBe("https://geo.example.test");
    expect(fixedUpstream("radar")).toBe("https://api.example.test");
  });
  it("should refuse an old tab after release activation changes", async () => {
    const authority = { ...createFixtureAuthority(), getRelease: async () => ({
      artifactId: GRANT.artifactId, releaseId: "release-002", authorSub: "publisher" }) };
    expect(await adaptGrantToReader(GRANT, authority)).toBeNull();
  });
});
