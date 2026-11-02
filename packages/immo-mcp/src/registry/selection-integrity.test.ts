import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTIFACT_INVOCATION_SCOPES, ARTIFACT_TOOL_SCOPES, ARTIFACT_SELECTION, ARTIFACT_PROFILE_REVISION, ARTIFACT_PROVIDER_VERSION } from "./artifact-profile.js";
import { compileComposition } from "./composition.js";
import type { ArtifactActivationRequest, ProviderDefinition } from "./mcp-registry.js";

const embedded = JSON.parse(readFileSync(new URL("../../config/immo-tools.v1.json", import.meta.url), "utf8"));
const immo: ProviderDefinition = { ...embedded.provider, tools: embedded.tools };
const artifact: ArtifactActivationRequest = {
  providerId: "sentropic.artifacts", selection: ARTIFACT_SELECTION,
  invocationScopes: ARTIFACT_INVOCATION_SCOPES, profileRevision: ARTIFACT_PROFILE_REVISION,
  finalizationContract: "test-finalization.v1", errorContract: "test-failure.v1",
};
const provider = (): ProviderDefinition => ({
  id: "sentropic.artifacts", version: ARTIFACT_PROVIDER_VERSION,
  tools: ARTIFACT_SELECTION.map(({ tool }) => ({
    name: tool, scope: ARTIFACT_TOOL_SCOPES[tool], binding: { context: "artifact-service", registeredBy: "registerTools" },
  })),
});

describe("selected inventory integrity", () => {
  it.each(["immo:read", "immo:search"])("should reject duplicate selected declarations with scope %s", (scope) => {
    const artifacts = provider();
    const tools = [...artifacts.tools, { ...artifacts.tools[1]!, scope }];
    expect(() => compileComposition([immo, { ...artifacts, tools }], { artifact }))
      .toThrow(/duplicate_tool/);
  });

  it("should reject duplicate artifact providers before compiling the selection", () => {
    expect(() => compileComposition([immo, provider(), provider()], { artifact }))
      .toThrow(/duplicate_tool/);
  });
});
