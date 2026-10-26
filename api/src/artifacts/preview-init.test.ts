import { describe, expect, it } from "vitest";
import { createFixtureAuthority } from "./reader-profile.js";
import { validatePreviewInit } from "./preview-init.js";

const BASE = {
  origin: "https://reader-1.pages.example.test",
  artifactId: "123e4567-e89b-12d3-a456-426614174000",
  releaseId: "123e4567-e89b-12d3-a456-426614174001",
  profileName: "demo",
  returnTarget: "/index.html",
};

describe("validatePreviewInit", () => {
  it("should accept an exact browser-bound init", async () => {
    const summary = await validatePreviewInit(BASE, createFixtureAuthority());
    expect(summary?.authorSub).toBe("author-alice");
    expect(summary?.capabilities).toEqual(["geo.read", "signals.protected-read"]);
    expect(summary?.returnTarget).toBe("/index.html");
  });

  it("should refuse forged origin, release, profile and return target", async () => {
    const authority = createFixtureAuthority();
    expect(await validatePreviewInit({ ...BASE, origin: "http://evil.example" }, authority)).toBeNull();
    expect(await validatePreviewInit({ ...BASE, releaseId: "release-999" }, authority)).toBeNull();
    expect(await validatePreviewInit({ ...BASE, profileName: "admin" }, authority)).toBeNull();
    expect(await validatePreviewInit({ ...BASE, returnTarget: "https://evil.example/x" }, authority)).toBeNull();
    expect(await validatePreviewInit({ ...BASE, returnTarget: "//evil.example/x" }, authority)).toBeNull();
  });
});
