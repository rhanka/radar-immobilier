import { describe, expect, it } from "vitest";
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from "@sentropic/artifacts/mcp-core";
import { IMMO_ARTIFACT_PROFILE as profile, IMMO_ARTIFACT_MANIFEST as manifest,
  createImmoArtifactManifest } from "./artifact-provider.js";
import { ARTIFACT_TOOL_SCOPES, type ArtifactToolName } from "./artifact-profile.js";

describe("P7 published effective profile", () => {
  it("should compile four closed schemas with caller keys and the invocation scope", () => {
    expect(manifest.tools.map((tool) => tool.name)).toEqual(profile.selectedCapabilities);
    expect(manifest.tools).toHaveLength(4);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(manifest.audit.artifactsProfileDigest).toBe(profile.profileDigest);
    for (const tool of manifest.tools) {
      expect(tool.requiredScopes).toEqual([ARTIFACT_TOOL_SCOPES[tool.name as ArtifactToolName]]);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      if (["artifacts_ensure", "artifacts_publish"].includes(tool.name)) {
        expect(tool.inputSchema.required).toContain("idempotencyKey");
        expect(tool.idempotency.required).toBe(true);
      }
    }
    expect(profile.validate("artifacts_list", {})).toEqual({ limit: 20, offset: 0 });
    expect(profile.validate("artifacts_ensure", { bindingName: "x", idempotencyKey: " key " }))
      .toEqual({ bindingName: "x", idempotencyKey: " key ", parameters: {} });
  });

  it("should declare explicit per-tool scopes and keep writes declared under the transition", () => {
    expect(Object.fromEntries(manifest.tools.map((tool) => [tool.name, tool.requiredScopes]))).toEqual({
      artifacts_ensure: ["immo:artifacts:write"], artifacts_publish: ["immo:artifacts:write"],
      artifacts_list: ["immo:artifacts:read"], artifacts_get: ["immo:artifacts:read"],
    });
    expect(manifest.authz.scopes).toEqual(["immo:artifacts:read", "immo:artifacts:write"]);
    const transition = createImmoArtifactManifest({ legacyReadScope: true });
    expect(Object.fromEntries(transition.tools.map((tool) => [tool.name, tool.requiredScopes]))).toEqual({
      artifacts_ensure: ["immo:artifacts:write"], artifacts_publish: ["immo:artifacts:write"],
      artifacts_list: [], artifacts_get: [],
    });
    expect(transition.authz.scopes).toEqual(["immo:artifacts:write"]);
    expect(manifest.tools.some((tool) => tool.requiredScopes.includes("immo:read"))).toBe(false);
  });

  it("should change provenance for a semantic change and reject duplicate selections", () => {
    const changed = compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
      contractRevisions: { ...RADAR_ARTIFACTS_PROFILE.contractRevisions, authorization: "next" } });
    expect(changed.profileDigest).not.toBe(profile.profileDigest);
    expect(() => compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
      selectedCapabilities: ["artifacts_ensure", "artifacts_ensure"] })).toThrow();
  });

  it.each(["", " \t ", "x".repeat(257), "\ud800"])("should refuse an invalid caller key %j", (key) => {
    expect(() => profile.validate("artifacts_ensure", { bindingName: "x", idempotencyKey: key })).toThrow();
  });

  it("should refuse caller authority and unselected operations before dispatch", () => {
    expect(() => profile.validate("artifacts_ensure", {
      bindingName: "x", idempotencyKey: "k", actorId: "mallory",
    })).toThrow();
    expect(() => profile.validate("artifacts_delete", {})).toThrow();
  });
});
