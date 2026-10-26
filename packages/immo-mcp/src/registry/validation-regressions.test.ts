import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTIFACT_PROFILE_REVISION, ARTIFACT_SELECTION } from "./artifact-profile.js";
import { compileComposition } from "./composition.js";
import { type ArtifactActivationRequest, type ProviderDefinition } from "./mcp-registry.js";

const embedded = JSON.parse(readFileSync(new URL("../../config/immo-tools.v1.json", import.meta.url), "utf8"));
const immo = (): ProviderDefinition => structuredClone({ ...embedded.provider, tools: embedded.tools });
const artifacts = (): ProviderDefinition => ({
  id: "sentropic.artifacts", version: "0.2.1",
  tools: ARTIFACT_SELECTION.map(({ tool }) => ({
    name: tool, scope: "immo:read", binding: { context: "artifact-service", registeredBy: "registerTools" },
  })),
});
const request = (): ArtifactActivationRequest => ({
  providerId: "sentropic.artifacts", selection: ARTIFACT_SELECTION.map((entry) => ({ ...entry })),
  invocationScope: "immo:read", profileRevision: ARTIFACT_PROFILE_REVISION,
  finalizationContract: "test-finalization.v1", errorContract: "test-failure.v1",
});

describe("activation regression guards", () => {
  it.each([
    ["empty handler descriptor", { binding: {} }],
    ["wrong handler seam", { binding: { context: "raw", registeredBy: "registerTools" } }],
    ["wrong registrar", { binding: { context: "data", registeredBy: "other" } }],
    ["changed tool scope", { scope: "immo:read" }],
  ])("should refuse %s", (_label, patch) => {
    const provider = immo();
    const tools = provider.tools.map((tool, i) => i === 0 ? { ...tool, ...patch } : tool);
    expect(() => compileComposition([{ ...provider, tools } as ProviderDefinition])).toThrow();
  });

  it("should prevent allowedScopes from widening the Immo policy", () => {
    const provider = immo();
    const tools = provider.tools.map((tool) => ({ ...tool, scope: "mcp:*" }));
    expect(() => compileComposition([{ ...provider, tools }], { allowedScopes: ["mcp:*"] })).toThrow();
  });

  it("should reject an incompatible Immo version without an optional pin", () => {
    expect(() => compileComposition([{ ...immo(), version: "9.9.9" }])).toThrow();
  });

  it("should reject duplicate artifact selections", () => {
    const artifact = request();
    const selection = [artifact.selection[0]!, ...artifact.selection.slice(0, 3)];
    expect(() => compileComposition([immo(), artifacts()], { artifact: { ...artifact, selection } })).toThrow();
  });

  it("should require selected capabilities on the declared artifact provider", () => {
    const provider = artifacts();
    expect(() => compileComposition([immo(), { ...provider, tools: provider.tools.slice(1) }], {
      artifact: request(),
    })).toThrow();
  });

  it("should refuse the Immo provider as an artifact implementation", () => {
    expect(() => compileComposition([immo()], { artifact: { ...request(), providerId: "immo" } })).toThrow();
  });

  it.each(["", "   ", "pending-upstream"])("should refuse unresolved contract references %j", (value) => {
    for (const field of ["finalizationContract", "errorContract"] as const) {
      expect(() => compileComposition([immo(), artifacts()], { artifact: { ...request(), [field]: value } })).toThrow();
    }
  });

  it("should bind both provider contracts into the candidate digest", () => {
    const providers = [immo(), artifacts()];
    const artifact = request();
    const baseline = compileComposition(providers, { artifact });
    for (const field of ["finalizationContract", "errorContract"] as const) {
      expect(compileComposition(providers, { artifact: { ...artifact, [field]: "other-contract.v1" } }).digest)
        .not.toBe(baseline.digest);
    }
  });

  it("should detach the frozen candidate from caller-owned selection objects", () => {
    const artifact = request();
    const candidate = compileComposition([immo(), artifacts()], { artifact });
    const before = JSON.stringify(candidate);
    Object.assign(artifact.selection[0]!, { path: "/altered" });
    expect(JSON.stringify(candidate)).toBe(before);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.artifact?.selection)).toBe(true);
    expect(Object.isFrozen(candidate.artifact?.selection[0])).toBe(true);
  });
});
