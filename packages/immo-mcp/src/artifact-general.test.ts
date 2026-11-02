import { describe, expect, it } from "vitest";
import {
  hasForgedArtifactCallerFields,
  IMMO_ARTIFACT_MANIFEST,
} from "./registry/artifact-provider.js";
import { ARTIFACT_INVOCATION_SCOPES, ARTIFACT_TOOL_NAMES } from "./registry/artifact-profile.js";
import { ARTIFACT_P0B } from "@radar/artifacts-host";

describe("artifact general tool selection", () => {
  it("exposes exactly the four artifact tools over the explicit artifact scopes", () => {
    expect([...ARTIFACT_TOOL_NAMES]).toEqual([
      "artifacts_ensure",
      "artifacts_publish",
      "artifacts_list",
      "artifacts_get",
      ...(ARTIFACT_P0B ? ["artifacts_get_source", "artifacts_set_access", "artifacts_delete"] : []),
    ]);
    expect(IMMO_ARTIFACT_MANIFEST.tools.map((tool) => tool.name).sort()).toEqual(
      [...ARTIFACT_TOOL_NAMES].sort(),
    );
    expect(ARTIFACT_INVOCATION_SCOPES).toEqual({ read: "immo:artifacts:read", write: "immo:artifacts:write" });
  });
});

describe("hasForgedArtifactCallerFields", () => {
  it("accepts the legitimate caller fields of every tool", () => {
    expect(hasForgedArtifactCallerFields({ bindingName: "summer", idempotencyKey: "k" })).toBe(false);
    expect(hasForgedArtifactCallerFields({ bindingName: "summer", idempotencyKey: "k",
      parameters: {} })).toBe(false);
    expect(hasForgedArtifactCallerFields({ artifactId: "123e4567-e89b-12d3-a456-426614174000",
      files: [], idempotencyKey: "k", profile: { theme: "dark" } })).toBe(false);
    expect(hasForgedArtifactCallerFields({ limit: 20, offset: 0 })).toBe(false);
    expect(hasForgedArtifactCallerFields({ artifactId: "123e4567-e89b-12d3-a456-426614174000" }))
      .toBe(false);
    expect(hasForgedArtifactCallerFields({})).toBe(false);
  });

  it("flags every forged actor, owner and storage identity field", () => {
    for (const key of ["actor", "actorId", "owner", "ownerId", "tenant", "tenantId",
      "storageScope", "storageScopeId", "paramsHash", "internalIdempotencyKey", "source"]) {
      expect(hasForgedArtifactCallerFields({ bindingName: "summer", idempotencyKey: "k",
        [key]: "forged" }), key).toBe(true);
    }
  });

  it("ignores non-records", () => {
    expect(hasForgedArtifactCallerFields(null)).toBe(false);
    expect(hasForgedArtifactCallerFields(undefined)).toBe(false);
    expect(hasForgedArtifactCallerFields("actorId")).toBe(false);
    expect(hasForgedArtifactCallerFields([{ actorId: "x" }])).toBe(false);
  });
});
