import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@sentropic/artifacts/mcp-core");
  vi.resetModules();
});

// Isolate version selection from the installed provider's capability compiler.
function providerVersion(version: string) {
  vi.resetModules();
  vi.doMock("@sentropic/artifacts/mcp-core", () => ({
    ARTIFACTS_PROVIDER_VERSION: version,
    RADAR_ARTIFACTS_PROFILE: { operations: [], contractRevisions: {} },
    compileArtifactsProfile: (profile: unknown) => profile,
  }));
  return import("./p0b-profile.js");
}

describe("artifact provider qualification", () => {
  it.each(["0.2.5", "0.2.6", "0.3.0"])("should activate all seven P0b tools for %s", async (version) => {
    const profile = await providerVersion(version);
    expect(profile.ARTIFACT_P0B).toBe(true);
    expect(profile.ACTIVE_ARTIFACT_TOOLS).toHaveLength(7);
    expect(profile.ACTIVE_ARTIFACT_TOOLS).toContain("artifacts_delete");
    expect(profile.ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId).toBe("immo-artifacts.p0b.v1");
  });

  it("should preserve the four legacy tools for 0.2.2", async () => {
    const profile = await providerVersion("0.2.2");
    expect(profile.ARTIFACT_P0B).toBe(false);
    expect(profile.ACTIVE_ARTIFACT_TOOLS).toHaveLength(4);
    expect(profile.ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId).toBe("immo-artifacts.v1");
  });

  it.each(["0.2.4", "0.3.1"])("should reject unqualified provider %s", async (version) => {
    await expect(providerVersion(version)).rejects.toThrow("artifact_provider_version_unqualified");
  });

  it("should require explicit deployment qualification before exposing part1", async () => {
    vi.stubEnv("ARTIFACTS_PROFILE_REVISION", "immo-artifacts.v2");
    await expect(providerVersion("0.2.6")).rejects.toThrow("artifact_switchovers_not_qualified");
    vi.stubEnv("ARTIFACTS_INPUTS_QUALIFIED", "true");
    vi.stubEnv("ARTIFACTS_RESULTS_QUALIFIED", "true");
    const profile = await providerVersion("0.2.6");
    expect(profile.ACTIVE_ARTIFACT_TOOLS).toHaveLength(9);
    expect(profile.ARTIFACT_PROFILE_DESCRIPTOR).toMatchObject({ requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: 2 });
  });

  it("should keep part1 closed during the input-only switchover", async () => {
    vi.stubEnv("ARTIFACTS_PROFILE_REVISION", "immo-artifacts.cas.v2");
    const profile = await providerVersion("0.2.6");
    expect(profile.ACTIVE_ARTIFACT_TOOLS).toHaveLength(7);
    expect(profile.ARTIFACT_PROFILE_DESCRIPTOR).toMatchObject({ requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: 1 });
  });
});
