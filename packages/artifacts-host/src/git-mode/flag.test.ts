import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACTS_GIT_MODE_ENV, GIT_ARTIFACT_TOOLS, GIT_MODE_OFF, GIT_TOOL_PROVIDER_ROUTING, gitProfileOperations,
  readGitModeStage, resolveGitMode, type GitArtifactTool,
} from "./flag.js";
import {
  ACTIVE_ARTIFACT_TOOLS, ARTIFACT_GIT_MODE, ARTIFACT_PROFILE_DESCRIPTOR, ARTIFACT_PROVIDER_VERSION,
  artifactProfileDescriptor, compileHostArtifactProfile, HOST_ARTIFACT_PROFILE,
} from "../p0b-profile.js";

/** Every git tool routed by 0.2.20 (fixture, equal to the pinned routing). */
const ROUTED_0220: Record<GitArtifactTool, readonly string[]> = Object.fromEntries(GIT_ARTIFACT_TOOLS.map((tool) =>
  [tool, ["0.2.20"]])) as unknown as Record<GitArtifactTool, readonly string[]>;

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

  it("qualifies every stage on the pinned 0.2.20 and refuses them on any other provider (fail-closed)", () => {
    expect(ARTIFACT_PROVIDER_VERSION).toBe("0.2.20");
    expect(GIT_TOOL_PROVIDER_ROUTING).toEqual(Object.fromEntries(GIT_ARTIFACT_TOOLS.map((tool) =>
      [tool, /git_commit|live_/.test(tool) ? ["0.2.18", "0.2.20"] : ["0.2.20"]])));
    for (const stage of ["bindings", "build", "live"]) {
      expect(resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: stage }, ARTIFACT_PROVIDER_VERSION).unrouted).toEqual([]);
      for (const other of ["0.2.18", "0.2.19", "0.3.0"]) {
        expect(() => resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: stage }, other)).toThrow("artifact_git_mode_provider_unqualified");
      }
    }
  });

  it("selects cumulative stages, never artifacts_list_app_sources (unrouted)", () => {
    expect(GIT_ARTIFACT_TOOLS as readonly string[]).not.toContain("artifacts_list_app_sources");
    const bindings = resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "bindings" }, "0.2.20", ROUTED_0220);
    expect(bindings.tools).toEqual(["artifacts_git_attach", "artifacts_fetch_app_source"]);
    expect(bindings.unrouted).toEqual([]);
    const partial = resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "bindings" }, "0.2.20",
      { ...ROUTED_0220, artifacts_fetch_app_source: [] });
    expect(partial).toMatchObject({ tools: ["artifacts_git_attach"], unrouted: ["artifacts_fetch_app_source"] });
    const build = resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "build" }, "0.2.20", ROUTED_0220);
    expect(build.tools).toEqual(["artifacts_git_attach", "artifacts_fetch_app_source", "artifacts_git_publish"]);
    const live = resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "live" }, "0.2.20", ROUTED_0220);
    expect(live.tools).toHaveLength(9);
    expect(live.tools as readonly string[]).not.toContain("artifacts_list_app_sources");
    expect(live.tools).toContain("artifacts_live_write");
  });

  it("refuses a stage whose anchor is not routed even when other tools are", () => {
    expect(() => resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "live" }, "0.2.18")).toThrow("artifact_git_mode_provider_unqualified");
  });

  it("boots off by default: no git tool in the active catalogue", () => {
    expect(ARTIFACT_GIT_MODE.stage).toBe("off");
    expect(ACTIVE_ARTIFACT_TOOLS.some((tool) => tool.includes("git") || tool.includes("live_") || tool.includes("app_source"))).toBe(false);
  });

  it("keeps every flag-off profile digest equal to origin/main (pinned before the git mode)", () => {
    // Computed on origin/main 621e8d2c4 with compileHostArtifactProfile(artifactProfileDescriptor(env)).
    const MAIN_DIGESTS = {
      "immo-artifacts.p0b.v1": "d3ac64a39f1c304ff24dc3e207d784e679fbb001ccc3c5fb527747360e641c4d",
      "immo-artifacts.cas.v2": "ed1af0a871a162c15b87fd1a7b85d3b714c6facf0d7140adcca7ccdd814acd85",
      "immo-artifacts.v2": "8c0292ce77c036ce3f67d6d298bcad16a26e1ca9e17cc91c725e9c3dd3f7a125",
    };
    expect(HOST_ARTIFACT_PROFILE.profileDigest).toBe(MAIN_DIGESTS["immo-artifacts.p0b.v1"]);
    for (const [revision, digest] of Object.entries(MAIN_DIGESTS)) {
      const descriptor = artifactProfileDescriptor({ ARTIFACTS_PROFILE_REVISION: revision,
        ARTIFACTS_INPUTS_QUALIFIED: "true", ARTIFACTS_RESULTS_QUALIFIED: "true" });
      expect(compileHostArtifactProfile(descriptor).profileDigest, revision).toBe(digest);
    }
  });

  it("starts with the flag off whatever garbage the git configuration holds", async () => {
    const garbage = { IMMO_ARTIFACTS_GIT_CURSOR_KEY: "!!not-base64", IMMO_ARTIFACTS_GIT_HUMANS: "{",
      IMMO_ARTIFACTS_GIT_COMMITTER_NAME: "half", IMMO_ARTIFACTS_GIT_BROKER_ORIGIN: "http://broker.example/path",
      IMMO_ARTIFACTS_BUILDER_URL: "ftp://builder", IMMO_ARTIFACTS_LIVE_DRAFT_KEYS: "v1=short", IMMO_ARTIFACTS_GIT_INSTALLATION_REF: " " };
    for (const flag of [undefined, "", "off"]) {
      vi.resetModules();
      vi.unstubAllEnvs();
      for (const [key, value] of Object.entries(garbage)) vi.stubEnv(key, value);
      if (flag !== undefined) vi.stubEnv(ARTIFACTS_GIT_MODE_ENV, flag);
      const profile = await import("../p0b-profile.js");
      expect(profile.ARTIFACT_GIT_MODE.stage).toBe("off");
      const compose = await import("./compose.js");
      expect(compose.composeGitModeFromEnv({ resolution: profile.ARTIFACT_GIT_MODE, pool: {} as never,
        storageScopeId: "s", env: process.env })).toEqual({});
      expect(() => compose.readGitModeConfig(process.env)).toThrow();
    }
  });

  it("boots with the flag on under the pinned 0.2.20 and selects exactly the stage tools", async () => {
    vi.resetModules();
    vi.stubEnv(ARTIFACTS_GIT_MODE_ENV, "bindings");
    const profile = await import("../p0b-profile.js");
    expect(profile.ARTIFACT_GIT_MODE.tools).toEqual(["artifacts_git_attach", "artifacts_fetch_app_source"]);
    expect(profile.HOST_ARTIFACT_PROFILE.selectedCapabilities).toEqual(expect.arrayContaining(["artifacts_git_attach"]));
  });

  it("compiles a profile that routes the selected git tools", () => {
    const tools = resolveGitMode({ [ARTIFACTS_GIT_MODE_ENV]: "live" }, "0.2.20", ROUTED_0220).tools;
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
