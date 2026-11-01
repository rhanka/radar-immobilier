import { describe, expect, it } from "vitest";
import {
  IMMO_TOOL_BINDINGS,
  IMMO_TOOL_NAMES,
  IMMO_TOOL_SCOPES,
} from "./immo-provider.js";
import {
  ARTIFACT_DURABLE_IDENTITY,
  ARTIFACT_EFFECTIVE_REQUIRED,
  ARTIFACT_INVOCATION_SCOPES,
  ARTIFACT_PROFILE_REVISION,
  ARTIFACT_PROVIDER_VERSION,
  ARTIFACT_SELECTION,
  ARTIFACT_TOOL_SCOPES,
  REQUIRED_PROVIDER_CONTRACTS,
} from "./artifact-profile.js";
import { compileComposition } from "./composition.js";
import {
  ARTIFACT_PROVIDER_ID,
  checkEffectiveProfile,
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

function artifactProvider(version: string = ARTIFACT_PROVIDER_VERSION): ProviderDefinition {
  return {
    id: ARTIFACT_PROVIDER_ID,
    version,
    tools: ARTIFACT_SELECTION.map((entry) => ({
      name: entry.tool,
      scope: ARTIFACT_TOOL_SCOPES[entry.tool],
      binding: { context: "artifact-service", registeredBy: "registerTools" },
    })),
  };
}

function artifactRequest(overrides?: Partial<ArtifactActivationRequest>): ArtifactActivationRequest {
  return {
    providerId: ARTIFACT_PROVIDER_ID,
    selection: ARTIFACT_SELECTION.map((entry) => ({ ...entry })),
    invocationScopes: ARTIFACT_INVOCATION_SCOPES,
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
    expect(candidate.digest).toMatch(/^[0-9a-f]{64}$/);
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
      artifact: artifactRequest({ invocationScopes: { read: "artifacts:*", write: ARTIFACT_INVOCATION_SCOPES.write } }),
    }))).toBe("generic_scope");
    // The pre-decision single immo:read invocation scope is no longer accepted.
    expect(codeOf(() => compileComposition(providers, {
      artifact: artifactRequest({ invocationScopes: { read: "immo:read", write: "immo:read" } }),
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
        { tool: "artifacts_delete", operation: "delete", method: "POST", path: "/delete", command: "delete" }],
    });
    expect(codeOf(() => compileComposition(providers, { artifact: foreign }))).toBe("unavailable_capability");
    const remappedSelection = artifactRequest().selection.map((entry) => (entry.tool === "artifacts_publish"
      ? { tool: "artifacts_publish", operation: "publish", method: "GET", path: "/publish", command: "publish" }
      : entry));
    const remapped = artifactRequest({ selection: remappedSelection });
    expect(codeOf(() => compileComposition(providers, { artifact: remapped }))).toBe("unavailable_capability");
  });

  it("should refuse an artifact provider without a validated selection", () => {
    const providers = [immoProvider(), artifactProvider()];
    expect(codeOf(() => compileComposition(providers))).toBe("unavailable_capability");
  });

  it("should exclude unselected artifact capabilities from the compiled inventory", () => {
    const baseline = compileComposition([immoProvider(), artifactProvider()], { artifact: artifactRequest() });
    const extended = artifactProvider();
    const withExtra: ProviderDefinition = {
      ...extended,
      tools: [...extended.tools, {
        name: "artifacts_delete",
        scope: ARTIFACT_INVOCATION_SCOPES.write,
        binding: { context: "artifact-service", registeredBy: "registerTools" },
      }],
    };
    const candidate = compileComposition([immoProvider(), withExtra], { artifact: artifactRequest() });
    expect(Object.keys(candidate.toolScopes)).toHaveLength(16);
    expect(candidate.toolScopes).not.toHaveProperty("artifacts_delete");
    expect(candidate.toolScopes).toEqual(baseline.toolScopes);
    expect(candidate.digest).toBe(baseline.digest);
  });

  it("should freeze the effective profile and durable identity in the digest", () => {
    const candidate = compileComposition([immoProvider(), artifactProvider()], { artifact: artifactRequest() });
    expect(candidate.artifact?.effectiveRequired.artifacts_ensure).toContain("idempotencyKey");
    expect(candidate.artifact?.effectiveRequired.artifacts_publish).toContain("idempotencyKey");
    expect(candidate.artifact?.effectiveRequired).toEqual({
      artifacts_ensure: [...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_ensure],
      artifacts_publish: [...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_publish],
      artifacts_list: [...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_list],
      artifacts_get: [...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_get],
    });
    expect(candidate.artifact?.durableIdentity).toEqual({ ...ARTIFACT_DURABLE_IDENTITY });
    expect(candidate.artifact?.requiredContracts).toEqual({ ...REQUIRED_PROVIDER_CONTRACTS });
    expect(Object.isFrozen(candidate.artifact?.effectiveRequired.artifacts_ensure)).toBe(true);
    expect(Object.isFrozen(candidate.artifact?.durableIdentity)).toBe(true);
    expect(Object.isFrozen(candidate.artifact?.requiredContracts)).toBe(true);
    const saved = ARTIFACT_DURABLE_IDENTITY.conflict;
    try {
      Object.assign(ARTIFACT_DURABLE_IDENTITY, { conflict: "revised conflict semantics" });
      const evolved = compileComposition([immoProvider(), artifactProvider()], { artifact: artifactRequest() });
      expect(evolved.digest).not.toBe(candidate.digest);
      expect(candidate.artifact?.durableIdentity.conflict).toBe(saved);
    } finally {
      Object.assign(ARTIFACT_DURABLE_IDENTITY, { conflict: saved });
    }
  });

  it("should refuse a mutation that drops the idempotency requirement", () => {
    expect(codeOf(() => checkEffectiveProfile({
      artifacts_ensure: ["bindingName"],
      artifacts_publish: ["artifactId", "files", "idempotencyKey"],
      artifacts_list: [],
      artifacts_get: ["artifactId"],
    }))).toBe("unavailable_capability");
    expect(codeOf(() => checkEffectiveProfile({
      artifacts_ensure: ["bindingName", "idempotencyKey"],
      artifacts_publish: ["artifactId", "files"],
      artifacts_list: [],
      artifacts_get: ["artifactId"],
    }))).toBe("unavailable_capability");
  });

  it.each(ARTIFACT_SELECTION)("should require its explicit artifact scope on $tool", ({ tool: name }) => {
    const other = ARTIFACT_TOOL_SCOPES[name] === ARTIFACT_INVOCATION_SCOPES.write
      ? ARTIFACT_INVOCATION_SCOPES.read : ARTIFACT_INVOCATION_SCOPES.write;
    for (const scope of ["immo:read", "immo:search", "immo:documents:read", "artifacts:*", other]) {
      const scoped = artifactProvider();
      const providers: ProviderDefinition[] = [{
        ...scoped,
        tools: scoped.tools.map((tool) => (tool.name === name
          ? { ...tool, scope }
          : tool)),
      }, immoProvider()];
      expect(codeOf(() => compileComposition(providers, { artifact: artifactRequest() }))).toBe("generic_scope");
    }
  });

  it("should require the qualified artifact provider version", () => {
    const missing = structuredClone(artifactProvider());
    Reflect.deleteProperty(missing, "version");
    expect(codeOf(() => compileComposition([immoProvider(), missing], {
      artifact: artifactRequest(),
    }))).toBe("incompatible_version");
    expect(codeOf(() => compileComposition([immoProvider(), artifactProvider("0.1.5")], {
      artifact: artifactRequest(),
    }))).toBe("incompatible_version");
    expect(codeOf(() => compileComposition([immoProvider(), artifactProvider("9.9.9")], {
      artifact: artifactRequest(),
    }))).toBe("incompatible_version");
  });

  it.each(["meta", undefined, { name: "publish" }])("should reject invalid selection command %j", (command) => {
    const providers = [immoProvider(), artifactProvider()];
    const selection = artifactRequest().selection.map((entry) => (entry.tool === "artifacts_publish"
      ? { ...entry, command }
      : entry)) as unknown as ArtifactActivationRequest["selection"];
    expect(codeOf(() => compileComposition(providers, {
      artifact: artifactRequest({ selection }),
    }))).toBe("unavailable_capability");
  });

  it("should detach nested selection data from the frozen candidate", () => {
    const base = artifactRequest();
    const selection = base.selection.map((entry) => ({
      ...entry, detail: { name: "publish" },
    })) as unknown as ArtifactActivationRequest["selection"];
    const candidate = compileComposition([immoProvider(), artifactProvider()], {
      artifact: { ...base, selection },
    });
    const before = JSON.stringify(candidate);
    for (const entry of selection) {
      (entry as unknown as { detail: { name: string } }).detail.name = "altered";
    }
    expect(JSON.stringify(candidate)).toBe(before);
    expect(candidate.artifact?.selection[0]).not.toHaveProperty("detail");
    expect(Object.isFrozen(candidate.artifact?.selection[0])).toBe(true);
  });

  it("should refuse a mutation that drops the bindingName requirement", () => {
    expect(codeOf(() => checkEffectiveProfile({
      artifacts_ensure: ["idempotencyKey"],
      artifacts_publish: ["artifactId", "files", "idempotencyKey"],
      artifacts_list: [],
      artifacts_get: ["artifactId"],
    }))).toBe("unavailable_capability");
  });
});
