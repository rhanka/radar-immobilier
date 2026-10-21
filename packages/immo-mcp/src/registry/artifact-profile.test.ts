import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_FORBIDDEN_CALLER_FIELDS,
  ARTIFACT_INVOCATION_SCOPE,
  ARTIFACT_LIMITS,
  ARTIFACT_MIME_TYPES,
  ARTIFACT_PROFILE_REVISION,
  ARTIFACT_RESERVED_FIRST_SEGMENTS,
  ARTIFACT_SELECTION,
  ARTIFACT_TOOL_NAMES,
  isArtifactToolName,
  REQUIRED_PROVIDER_CONTRACTS,
  validateCallerKey,
  validateListPagination,
} from "./artifact-profile.js";

const config = JSON.parse(readFileSync(
  new URL("../../config/immo-artifacts.v1.json", import.meta.url),
  "utf8",
)) as {
  invocationScope: string;
  selection: { tool: string; operation: string; method: string; path: string }[];
  effectiveProfile: {
    artifacts_publish: {
      files: {
        maxCount: number;
        maxDecodedBytesPerFile: number;
        maxDecodedBytesTotal: number;
        mimeTypes: string[];
        reservedFirstSegments: string[];
      };
    };
    closedArguments: string[];
  };
  durableIdentity: { payloadHashInKey: boolean };
  activation: { requiresFinalizationBinding: boolean; requiresErrorBinding: boolean };
  requiredContracts: Record<string, string>;
};

describe("artifact effective profile", () => {
  it("should select exactly the four tools with their operation mapping", () => {
    expect([...ARTIFACT_TOOL_NAMES]).toEqual([
      "artifacts_ensure",
      "artifacts_publish",
      "artifacts_list",
      "artifacts_get",
    ]);
    expect(ARTIFACT_SELECTION).toEqual([
      { tool: "artifacts_ensure", operation: "ensure", method: "POST", path: "/ensure", command: "ensure" },
      { tool: "artifacts_publish", operation: "publish", method: "POST", path: "/publish", command: "publish" },
      { tool: "artifacts_list", operation: "list", method: "POST", path: "/list", command: "list" },
      { tool: "artifacts_get", operation: "meta", method: "GET", path: "/meta/{artifactId}", command: "meta" },
    ]);
    expect(ARTIFACT_INVOCATION_SCOPE).toBe("immo:read");
  });

  it("should reject missing, blank and overlong caller keys", () => {
    expect(validateCallerKey(undefined)).toHaveLength(1);
    expect(validateCallerKey("   ")).toHaveLength(1);
    expect(validateCallerKey("x".repeat(257))).toHaveLength(1);
    expect(validateCallerKey("x".repeat(256))).toEqual([]);
  });

  it("should preserve the original caller key including whitespace", () => {
    expect(validateCallerKey("  retry-7  ")).toEqual([]);
  });

  it("should bound list pagination around the effective defaults", () => {
    expect(ARTIFACT_LIMITS.listLimitDefault).toBe(20);
    expect(validateListPagination(0, 0)).toHaveLength(1);
    expect(validateListPagination(101, 0)).toHaveLength(1);
    expect(validateListPagination(20, -1)).toHaveLength(1);
    expect(validateListPagination(undefined, undefined)).toEqual([]);
  });

  it("should record the pending upstream contracts without inventing them", () => {
    expect(REQUIRED_PROVIDER_CONTRACTS.finalizationAuthorization).toBe("pending-upstream");
    expect(REQUIRED_PROVIDER_CONTRACTS.typedFailure).toBe("pending-upstream");
    expect(REQUIRED_PROVIDER_CONTRACTS.capabilitySelection).toBe("pending-upstream");
    expect(REQUIRED_PROVIDER_CONTRACTS.effectiveProfile).toBe(ARTIFACT_PROFILE_REVISION);
  });

  it("should keep the embedded config aligned with the profile", () => {
    expect(config.invocationScope).toBe("immo:read");
    expect(config.selection).toEqual(ARTIFACT_SELECTION);
    for (const entry of config.selection) {
      expect(isArtifactToolName(entry.tool)).toBe(true);
    }
    const files = config.effectiveProfile.artifacts_publish.files;
    expect(files.maxCount).toBe(ARTIFACT_LIMITS.filesMax);
    expect(files.maxDecodedBytesPerFile).toBe(ARTIFACT_LIMITS.decodedBytesPerFile);
    expect(files.maxDecodedBytesTotal).toBe(ARTIFACT_LIMITS.decodedBytesTotal);
    expect(files.mimeTypes).toEqual([...ARTIFACT_MIME_TYPES]);
    expect(files.reservedFirstSegments).toEqual([...ARTIFACT_RESERVED_FIRST_SEGMENTS]);
    expect(config.effectiveProfile.closedArguments).toEqual([...ARTIFACT_FORBIDDEN_CALLER_FIELDS]);
    expect(config.durableIdentity.payloadHashInKey).toBe(false);
    expect(config.activation.requiresFinalizationBinding).toBe(true);
    expect(config.activation.requiresErrorBinding).toBe(true);
    expect(config.requiredContracts).toEqual(REQUIRED_PROVIDER_CONTRACTS);
  });
});
