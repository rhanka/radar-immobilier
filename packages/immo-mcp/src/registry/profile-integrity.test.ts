import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTIFACT_EFFECTIVE_REQUIRED, ARTIFACT_LIMITS, ARTIFACT_SELECTION } from "./artifact-profile.js";
import { compileComposition } from "./composition.js";
import type { ArtifactActivationRequest, ProviderDefinition } from "./mcp-registry.js";

const embedded = JSON.parse(readFileSync(new URL("../../config/immo-tools.v1.json", import.meta.url), "utf8"));
const config = JSON.parse(readFileSync(new URL("../../config/immo-artifacts.v1.json", import.meta.url), "utf8"));
const providers: ProviderDefinition[] = [{ ...embedded.provider, tools: embedded.tools }, {
  id: "sentropic.artifacts", version: "0.2.2",
  tools: ARTIFACT_SELECTION.map(({ tool }) => ({
    name: tool, scope: "immo:read", binding: { context: "artifact-service", registeredBy: "registerTools" },
  })),
}];
const artifact: ArtifactActivationRequest = {
  providerId: "sentropic.artifacts", selection: ARTIFACT_SELECTION,
  invocationScope: "immo:read", profileRevision: "immo-artifacts.v1",
  finalizationContract: "test-finalization.v1", errorContract: "test-failure.v1",
};

describe("artifact profile integrity", () => {
  it("should freeze every embedded effective-profile field into the candidate", () => {
    const candidate = compileComposition(providers, { artifact });
    expect(candidate.artifact).toHaveProperty("effectiveProfile", config.effectiveProfile);
    const profile = Reflect.get(candidate.artifact!, "effectiveProfile");
    const assertFrozen = (value: unknown): void => {
      if (value !== null && typeof value === "object") {
        expect(Object.isFrozen(value)).toBe(true);
        Object.values(value).forEach(assertFrozen);
      }
    };
    assertFrozen(profile);
  });

  it("should change the digest after an authorized file-bound evolution", () => {
    const before = compileComposition(providers, { artifact });
    const saved = ARTIFACT_LIMITS.filesMax;
    try {
      Object.assign(ARTIFACT_LIMITS, { filesMax: saved - 1 });
      const after = compileComposition(providers, { artifact });
      expect(after.digest).not.toBe(before.digest);
      expect(before.artifact).toHaveProperty("effectiveProfile.artifacts_publish.files.maxCount", saved);
      expect(after.artifact).toHaveProperty("effectiveProfile.artifacts_publish.files.maxCount", saved - 1);
    } finally {
      Object.assign(ARTIFACT_LIMITS, { filesMax: saved });
    }
  });

  it.each(["artifacts_ensure", "artifacts_publish"] as const)(
    "should refuse compilation when %s drops its caller key",
    (tool) => {
      const saved = ARTIFACT_EFFECTIVE_REQUIRED[tool];
      try {
        ARTIFACT_EFFECTIVE_REQUIRED[tool] = saved.filter((field) => field !== "idempotencyKey");
        expect(() => compileComposition(providers, { artifact })).toThrow(/unavailable_capability/);
      } finally {
        ARTIFACT_EFFECTIVE_REQUIRED[tool] = saved;
      }
    },
  );
});
