import { describe, expect, it } from "vitest";
import { createFixtureAuthority } from "./reader-profile.js";
import { createActivationRegistry } from "./release-activation.js";

describe("release activation", () => {
  it("should activate the approved release only", async () => {
    const registry = createActivationRegistry({ now: () => 1_000 });
    const authority = createFixtureAuthority();
    expect(await registry.activate("123e4567-e89b-12d3-a456-426614174000", "release-999", authority)).toBeNull();
    const record = await registry.activate("123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174001", authority);
    expect(record?.profileName).toBe("demo");
    expect(registry.matches("123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174001", "pol-001")).toBe(true);
    expect(registry.matches("123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174001", "pol-002")).toBe(false);
  });

  it("should keep old tabs on their pinned release without upgrade", async () => {
    const registry = createActivationRegistry({ now: () => 1_000 });
    await registry.activate("123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174001", createFixtureAuthority());
    expect(registry.canUpgrade("123e4567-e89b-12d3-a456-426614174000", "123e4567-e89b-12d3-a456-426614174001")).toBe(false);
    expect(registry.canUpgrade("123e4567-e89b-12d3-a456-426614174000", "release-002")).toBe(true);
  });
});
