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

  it("should never let a stale activation overwrite the current release", async () => {
    const artifact = "123e4567-e89b-12d3-a456-426614174000";
    const staleRelease = "123e4567-e89b-12d3-a456-426614174001";
    const currentRelease = "223e4567-e89b-12d3-a456-426614174001";
    const registry = createActivationRegistry({ now: () => 1_000 });
    const base = createFixtureAuthority();
    let current = { artifactId: artifact, releaseId: staleRelease, authorSub: "author-alice" };
    let entered: (() => void) | null = null;
    let releaseGate: (() => void) | null = null;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const gatePromise = new Promise<void>((resolve) => { releaseGate = resolve; });
    let profileCalls = 0;
    const authority = { ...base,
      getRelease: async (id: string) => (id === artifact ? { ...current } : base.getRelease(id)),
      getProfile: async (id: string) => {
        profileCalls += 1;
        if (profileCalls === 1) {
          entered!();
          await gatePromise;
        }
        return base.getProfile(id);
      } };
    const stale = registry.activate(artifact, staleRelease, authority);
    await enteredPromise;
    current = { artifactId: artifact, releaseId: currentRelease, authorSub: "author-alice" };
    expect(await registry.activate(artifact, currentRelease, authority)).not.toBeNull();
    releaseGate!();
    expect(await stale).toBeNull();
    expect(registry.active(artifact)?.releaseId).toBe(currentRelease);
  });
});
