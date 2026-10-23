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

  it("should route only to fixed upstreams", () => {
    expect(fixedUpstream("geo")).toBe("https://geo.example.test");
    expect(fixedUpstream("radar")).toBe("https://api.example.test");
  });
});
