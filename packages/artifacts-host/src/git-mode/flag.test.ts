import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACTS_GIT_MODE_ENV, GIT_ARTIFACT_TOOLS, GIT_MODE_OFF, GIT_TOOL_PROVIDER_ROUTING, gitProfileOperations,
  readGitModeStage, resolveGitMode, type GitArtifactTool,
} from "./flag.js";
import {
  ACTIVE_ARTIFACT_TOOLS, ARTIFACT_GIT_MODE, ARTIFACT_PROFILE_DESCRIPTOR, ARTIFACT_PROVIDER_VERSION,
  compileHostArtifactProfile, HOST_ARTIFACT_PROFILE,
} from "../p0b-profile.js";

/** What the 0.2.19 pin will declare once M1 is qualified (fixture only). */
const ROUTED_0219: Record<GitArtifactTool, readonly string[]> = Object.fromEntries(GIT_ARTIFACT_TOOLS.map((tool) =>
  [tool, ["0.2.19"]])) as unknown as Record<GitArtifactTool, readonly string[]>;

describe("git mode flag", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("defaults to off for unset, empty and explicit off", () => {
    expect(readGitModeStage({})).toBe("off");
    expect(readGitModeStage({ [ARTIFACTS_GIT_MODE_ENV]: "" })).toBe("off");
    expect(readGitModeStage({ [ARTIFACTS_GIT_MODE_ENV]: " off " })).toBe("off");
    expect(resolveGitMode({}, ARTIFACT_PROVIDER_VERSION)).toBe(GIT_MODE_OFF);
  });

  it("refuses an unknown value", () => {
    for (const value of ["true", "1", "on", "Bindings", "m2"]) {
      expect(() => readGitModeStage({ [ARTIFACTS_GIT_MODE_ENV]: value })).toThrow("artifact_git_mode_invalid");
    }
  });

  it("refuses every stage on the pinned provider (fail-closed until the 0.2.19 qualification)", () => {
    for (const stage of ["bindings", "build", "live"]) {
      expect(() => resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: stage }, ARTIFACT_PROVIDER_VERSION))
        .toThrow("artifact_git_mode_provider_unqualified");
      expect(() => resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: stage }, "0.2.19"))
        .toThrow("artifact_git_mode_provider_unqualified");
    }
    expect(GIT_TOOL_PROVIDER_ROUTING.artifacts_git_attach).toEqual([]);
  });

  it("selects cumulative stages, never artifacts_list_app_sources (unrouted)", () => {
    expect(GIT_ARTIFACT_TOOLS as readonly string[]).not.toContain("artifacts_list_app_sources");
    const bindings = resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "bindings" }, "0.2.19", ROUTED_0219);
    expect(bindings.tools).toEqual(["artifacts_git_attach", "artifacts_fetch_app_source"]);
    expect(bindings.unrouted).toEqual([]);
    const partial = resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "bindings" }, "0.2.19",
      { ...ROUTED_0219, artifacts_fetch_app_source: [] });
    expect(partial).toMatchObject({ tools: ["artifacts_git_attach"], unrouted: ["artifacts_fetch_app_source"] });
    const build = resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "build" }, "0.2.19", ROUTED_0219);
    expect(build.tools).toEqual(["artifacts_git_attach", "artifacts_fetch_app_source", "artifacts_git_publish"]);
    const live = resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "live" }, "0.2.19", ROUTED_0219);
    expect(live.tools).toHaveLength(9);
    expect(live.tools as readonly string[]).not.toContain("artifacts_list_app_sources");
    expect(live.tools).toContain("artifacts_live_write");
  });

  it("refuses a stage whose anchor is not routed even when other tools are", () => {
    expect(() => resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "live" }, "0.2.18")).toThrow("artifact_git_mode_provider_unqualified");
  });

  it("boots off by default: no git tool in the active catalogue, profile unchanged", () => {
    expect(ARTIFACT_GIT_MODE.stage).toBe("off");
    expect(ACTIVE_ARTIFACT_TOOLS.some((tool) => tool.includes("git") || tool.includes("live_") || tool.includes("app_source"))).toBe(false);
    expect(compileHostArtifactProfile(ARTIFACT_PROFILE_DESCRIPTOR, []).profileDigest).toBe(HOST_ARTIFACT_PROFILE.profileDigest);
  });

  it("refuses to boot with the flag on under the pinned provider", async () => {
    vi.resetModules();
    vi.stubEnv(ARTIFACTS_GIT_MODE_ENV, "bindings");
    await expect(import("../p0b-profile.js")).rejects.toThrow("artifact_git_mode_provider_unqualified");
  });

  it("compiles a profile that routes the selected git tools", () => {
    const tools = resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "live" }, "0.2.19", ROUTED_0219).tools;
    const profile = compileHostArtifactProfile(ARTIFACT_PROFILE_DESCRIPTOR, tools);
    expect(profile.selectedCapabilities).toEqual(expect.arrayContaining([...tools]));
    expect(profile.capabilityForRoute("POST", "/git_attach")).toBe("artifacts_git_attach");
    expect(profile.capabilityForRoute("POST", "/live_write")).toBe("artifacts_live_write");
    expect(profile.capabilityForRoute("POST", "/list_app_sources")).toBeUndefined();
    expect(profile.profileDigest).not.toBe(HOST_ARTIFACT_PROFILE.profileDigest);
  });

  it("derives one operation per git tool with the provider limits", () => {
    expect(gitProfileOperations(["artifacts_git_commit", "artifacts_live_read", "artifacts_git_attach"])).toEqual([
      { operation: "git_commit", limits: { idempotencyKeyMaxUnits: 256, gitMessageMaxUnits: 16384 }, defaults: {} },
      { operation: "live_read", limits: {}, defaults: {} },
      { operation: "git_attach", limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
    ]);
  });
});
