import { describe, expect, it } from "vitest";
import {
  IMMO_TOOL_BINDINGS,
  IMMO_TOOL_NAMES,
  IMMO_TOOL_SCOPES,
} from "./immo-provider.js";
import { compileComposition } from "./composition.js";
import {
  REGISTRY_NETWORK_POLICY,
  RegistryError,
  type ProviderDefinition,
} from "./mcp-registry.js";

export function immoProvider(version = "0.0.1"): ProviderDefinition {
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

export function codeOf(task: () => unknown): string {
  try {
    task();
  } catch (error) {
    expect(error).toBeInstanceOf(RegistryError);
    return (error as RegistryError).code;
  }
  throw new Error("expected a RegistryError");
}

describe("local composition registry", () => {
  it("should compile the twelve-tool Immo composition with a stable digest", () => {
    const first = compileComposition([immoProvider()]);
    const second = compileComposition([immoProvider()]);
    expect(first.providers).toEqual(["immo"]);
    expect(Object.keys(first.toolScopes)).toHaveLength(12);
    expect(first.artifact).toBeNull();
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(second.digest).toBe(first.digest);
  });

  it("should make no central-registry request", () => {
    expect(REGISTRY_NETWORK_POLICY).toBe("no-central-registry-request");
    const fetchBefore = globalThis.fetch;
    (globalThis as { fetch?: unknown }).fetch = () => { throw new Error("network used"); };
    try {
      expect(compileComposition([immoProvider()]).digest).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      globalThis.fetch = fetchBefore;
    }
  });

  it("should reject unknown providers, duplicates and missing bindings", () => {
    expect(codeOf(() => compileComposition([{ id: "other", version: "1.0.0", tools: [] }]))).toBe("unknown_provider");
    expect(codeOf(() => compileComposition([immoProvider(), immoProvider()]))).toBe("duplicate_tool");
    const disjoint: ProviderDefinition = {
      id: "immo",
      version: "0.0.1",
      tools: [{
        name: "artifacts_publish",
        scope: "immo:read",
        binding: { context: "data", registeredBy: "registerTools" },
      }],
    };
    expect(codeOf(() => compileComposition([immoProvider(), disjoint]))).toBe("duplicate_tool");
    const base = immoProvider();
    const broken = base.tools.map((tool, index) => (index === 0
      ? { name: "search_lots", scope: "immo:search", binding: { context: "", registeredBy: "" } }
      : tool));
    expect(codeOf(() => compileComposition([{ ...base, tools: broken }]))).toBe("missing_binding");
    const malformed = base.tools.map((tool, index) => (index === 0
      ? { name: "Bad-Name!", scope: "immo:search", binding: { context: "data", registeredBy: "registerTools" } }
      : tool));
    expect(codeOf(() => compileComposition([{ ...base, tools: malformed }]))).toBe("malformed_parameter");
  });

  it("should reject incompatible versions and generic scopes", () => {
    expect(codeOf(() => compileComposition([immoProvider("x")]))).toBe("incompatible_version");
    expect(codeOf(() => compileComposition([immoProvider()], {
      expectedVersions: { immo: "9.9.9" },
    }))).toBe("incompatible_version");
    const base = immoProvider();
    const generic = base.tools.map((tool, index) => (index === 0
      ? { name: "search_lots", scope: "mcp:*", binding: { context: "data", registeredBy: "registerTools" } }
      : tool));
    expect(codeOf(() => compileComposition([{ ...base, tools: generic }]))).toBe("generic_scope");
  });

  it("should lock the twelve Immo tools against removal, rename or growth", () => {
    const base = immoProvider();
    expect(codeOf(() => compileComposition([{ ...base, tools: base.tools.slice(1) }]))).toBe("immutable_toolset");
    const renamed = base.tools.map((tool) => (tool.name === "search_lots"
      ? { ...tool, name: "search_lots_v2" }
      : tool));
    expect(codeOf(() => compileComposition([{ ...base, tools: renamed }]))).toBe("immutable_toolset");
    const extra = { name: "extra_tool", scope: "immo:read", binding: { context: "data", registeredBy: "registerTools" } };
    expect(codeOf(() => compileComposition([{ ...base, tools: [...base.tools, extra] }]))).toBe("immutable_toolset");
  });
});
