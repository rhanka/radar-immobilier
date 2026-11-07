import { ARTIFACTS_TOOL_DEFINITIONS } from "@sentropic/artifacts/mcp-core";
import { GIT_ARTIFACT_TOOLS, GIT_MODE_OFF } from "@radar/artifacts-host";
import { describe, expect, it } from "vitest";
import { gitOverlayFor, readArtifactConfig } from "./artifact-config.js";
import { gitAuthoringSection, getAuthoringGuide, AUTHORING_GUIDE_REVISION } from "./artifact-authoring-guide.js";
import { GIT_EFFECTIVE_REQUIRED, gitEffectiveProfile, gitSelection, gitToolScopes } from "./artifact-git-profile.js";
import { ARTIFACT_SELECTION, ARTIFACT_TOOL_NAMES, ARTIFACT_TOOL_SCOPES } from "./artifact-profile.js";
import { IMMO_ARTIFACT_MANIFEST } from "./artifact-provider.js";

const ALL = [...GIT_ARTIFACT_TOOLS];
const isGit = (name: string) => (ALL as string[]).includes(name);

describe("git mode, flag off (default)", () => {
  it("selects, scopes and serves no git tool", () => {
    expect(ARTIFACT_TOOL_NAMES.filter(isGit)).toEqual([]);
    expect(Object.keys(ARTIFACT_TOOL_SCOPES).filter(isGit)).toEqual([]);
    expect(ARTIFACT_SELECTION.filter((entry) => isGit(entry.tool))).toEqual([]);
    expect(IMMO_ARTIFACT_MANIFEST.tools.filter((tool) => isGit(tool.name))).toEqual([]);
  });

  it("merges nothing from the git overlay into the assembled configuration", () => {
    const config = readArtifactConfig();
    expect(Object.keys(config.toolScopes).filter(isGit)).toEqual([]);
    expect(Object.keys(config.effectiveProfile).filter(isGit)).toEqual([]);
    expect(gitOverlayFor([])).toEqual({ toolScopes: {}, selection: [], effectiveProfile: {} });
  });

  it("keeps the authoring guide without a git section and on its historical revision", () => {
    expect(Object.hasOwn(getAuthoringGuide(), "gitMode")).toBe(false);
    expect(AUTHORING_GUIDE_REVISION).not.toContain("-git-");
    expect(gitAuthoringSection(GIT_MODE_OFF)).toBeUndefined();
  });
});

describe("git mode tables, flag on (fakes)", () => {
  it("keeps the embedded overlay identical to the code tables", () => {
    expect(gitOverlayFor(ALL)).toEqual({ toolScopes: gitToolScopes(ALL), selection: gitSelection(ALL),
      effectiveProfile: gitEffectiveProfile(ALL) });
  });

  it("scopes reads to immo:artifacts:read and every other git tool to immo:artifacts:write", () => {
    expect(gitToolScopes(ALL)).toEqual({
      artifacts_git_attach: "immo:artifacts:write",
      artifacts_fetch_app_source: "immo:artifacts:read", artifacts_git_publish: "immo:artifacts:write",
      artifacts_git_commit: "immo:artifacts:write", artifacts_live_write: "immo:artifacts:write",
      artifacts_live_read: "immo:artifacts:read", artifacts_live_reset: "immo:artifacts:write",
      artifacts_live_status: "immo:artifacts:read", artifacts_live_control: "immo:artifacts:write" });
  });

  it("records the provider's required arguments for every git tool", () => {
    for (const tool of ALL) {
      const schema = ARTIFACTS_TOOL_DEFINITIONS[tool as keyof typeof ARTIFACTS_TOOL_DEFINITIONS].inputSchema as { required?: string[] };
      expect(GIT_EFFECTIVE_REQUIRED[tool], tool).toEqual(schema.required ?? []);
    }
  });

  it("routes each git tool on its provider path", () => {
    expect(gitSelection(["artifacts_git_attach"])).toEqual([
      { tool: "artifacts_git_attach", operation: "git_attach", method: "POST", path: "/git_attach", command: "git_attach" }]);
  });

  it("serves the git path and the enforced ceilings in the guide section", () => {
    const section = gitAuthoringSection({ stage: "live", tools: ALL, unrouted: [] })!;
    expect(section.unavailableTools).toEqual([]);
    expect(ALL as string[]).not.toContain("artifacts_list_app_sources");
    expect(section.ceilings).toMatchObject({ releaseFilesMax: 255, releaseFileBytesMax: 16 * 1024 * 1024,
      releaseTotalBytesMax: 64 * 1024 * 1024, gitCommitBytesMax: 8 * 1024 * 1024, liveWriteBytesMax: 2 * 1024 * 1024 });
    expect(section.path.join(" ")).toContain("OWN page and branch");
    expect(section.path.join(" ")).toContain("Invited live readers");
    expect(section.refusedWritePaths).toContain("ui/dist/**");
    const bindingsOnly = gitAuthoringSection({ stage: "bindings", tools: ["artifacts_git_attach"], unrouted: [] })!;
    expect(bindingsOnly.path.join(" ")).not.toContain("Invited live readers");
  });
});
