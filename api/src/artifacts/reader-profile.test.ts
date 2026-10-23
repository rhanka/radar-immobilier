import { describe, expect, it } from "vitest";
import {
  createFixtureAuthority,
  intersectCapabilities,
} from "./reader-profile.js";

describe("reader-profile seam", () => {
  it("should intersect profile and reader capabilities", async () => {
    const authority = createFixtureAuthority();
    const profile = await authority.getProfile("123e4567-e89b-12d3-a456-426614174000");
    const rights = await authority.getRights("reader-alice");
    expect(profile).not.toBeNull();
    expect(rights).not.toBeNull();
    expect(intersectCapabilities(profile!, rights!)).toEqual([
      "geo.read",
      "signals.protected-read",
    ]);
  });

  it("should report unapproved readers as not approved", async () => {
    const authority = createFixtureAuthority();
    expect((await authority.getRights("reader-mallory"))?.approved).toBe(false);
    expect(await authority.getRelease("unknown-artifact")).toBeNull();
  });
});
