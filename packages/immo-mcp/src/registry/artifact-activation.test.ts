import { describe, expect, it } from "vitest";
import {
  IMMO_TOOL_BINDINGS,
  IMMO_TOOL_NAMES,
  IMMO_TOOL_SCOPES,
} from "./immo-provider.js";
import { ARTIFACT_PROFILE_REVISION, ARTIFACT_SELECTION } from "./artifact-profile.js";
import { compileComposition } from "./composition.js";
import {
  ARTIFACT_PROVIDER_ID,
  RegistryError,
  type ArtifactActivationRequest,
  type ProviderDefinition,
} from "./mcp-registry.js";

function immoProvider(version = "0.0.1"): ProviderDefinition {
  return {
    id: "immo",
    version,
    tools: IMMO_TOOL_NAMES.map((name) => ({
      name,
      scope: IMMO_TOOL_SCOPES[name],
      binding: { ...IMMO_TOOL_BINDINGS[name] },
    })),
  };
}

function codeOf(task: () => unknown): string {
  try {
    task();
  } catch (error) {
    expect(error).toBeInstanceOf(RegistryError);
    return (error as RegistryError).code;
  }
  throw new Error("expected a RegistryError");
}

function artifactProvider(version = "0.1.4"): ProviderDefinition {
  return {
    id: ARTIFACT_PROVIDER_ID,
    version,
    tools: ARTIFACT_SELECTION.map((entry) => ({
      name: entry.tool,
      scope: "immo:read",
      binding: { context: "artifact-service", registeredBy: "registerTools" },
    })),
  };
}

function artifactRequest(overrides?: Partial<ArtifactActivationRequest>): ArtifactActivationRequest {
  return {
    providerId: ARTIFACT_PROVIDER_ID,
    selection: ARTIFACT_SELECTION.map((entry) => ({ ...entry })),
    invocationScope: "immo:read",
    profileRevision: ARTIFACT_PROFILE_REVISION,
    finalizationContract: "upstream-finalization.v1",
    errorContract: "upstream-typed-failure.v1",
    ...overrides,
  };
}

describe("artifact activation", () => {
  it("should freeze the candidate without mutating the active registry", () => {
    const active = [immoProvider()];
    const before = JSON.stringify(active);
    const candidate = compileComposition([...active, artifactProvider()], { artifact: artifactRequest() });
    expect(candidate.artifact?.selection).toHaveLength(4);
    expect(JSON.stringify(active)).toBe(before);
    expect(candidate.digest).not.toBe(compileComposition(active).digest);
    expect(candidate.digest).not.toBe(
      compileComposition([...active, artifactProvider("0.1.5")], { artifact: artifactRequest() }).digest,
    );
  });

  it("should refuse activation without its provider contracts", () => {
    const providers = [immoProvider(), artifactProvider()];
    expect(codeOf(() => compileComposition(providers, {
      artifact: artifactRequest({ finalizationContract: null }),
    }))).toBe("missing_finalization_binding");
    expect(codeOf(() => compileComposition(providers, {
      artifact: artifactRequest({ errorContract: null }),
    }))).toBe("missing_error_binding");
    expect(codeOf(() => compileComposition(providers, {
      artifact: artifactRequest({ invocationScope: "artifacts:*" }),
    }))).toBe("generic_scope");
    expect(codeOf(() => compileComposition(providers, {
      artifact: artifactRequest({ profileRevision: "immo-artifacts.v9" }),
    }))).toBe("incompatible_version");
    expect(codeOf(() => compileComposition(providers, {
      artifact: artifactRequest({ providerId: "unknown" }),
    }))).toBe("unknown_provider");
  });

  it("should reject unavailable artifact capabilities and mappings", () => {
    const providers = [immoProvider(), artifactProvider()];
    const foreign = artifactRequest({
      selection: [...artifactRequest().selection.slice(0, 3),
        { tool: "artifacts_delete", operation: "delete", method: "POST", path: "/delete" }],
    });
    expect(codeOf(() => compileComposition(providers, { artifact: foreign }))).toBe("unavailable_capability");
    const remappedSelection = artifactRequest().selection.map((entry) => (entry.tool === "artifacts_publish"
      ? { tool: "artifacts_publish", operation: "publish", method: "GET", path: "/publish" }
      : entry));
    const remapped = artifactRequest({ selection: remappedSelection });
    expect(codeOf(() => compileComposition(providers, { artifact: remapped }))).toBe("unavailable_capability");
  });
});
