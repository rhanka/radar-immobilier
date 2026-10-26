/**
 * Effective H4 artifact profile shared by the embedded configuration and the
 * compatibility tests. Records the four-tool selection, the caller-visible
 * input bounds, the durable command-identity semantics and the provider
 * contract revisions required before activation.
 */

export const ARTIFACT_PROVIDER_ID = "sentropic.artifacts" as const;
export const ARTIFACT_INVOCATION_SCOPE = "immo:read" as const;
export const ARTIFACT_PROFILE_REVISION = "immo-artifacts.v1" as const;
export const ARTIFACT_PROVIDER_VERSION = "0.2.1" as const;

export const ARTIFACT_TOOL_NAMES = [
  "artifacts_ensure",
  "artifacts_publish",
  "artifacts_list",
  "artifacts_get",
] as const;

export type ArtifactToolName = (typeof ARTIFACT_TOOL_NAMES)[number];

export interface ArtifactSelectionEntry {
  readonly tool: ArtifactToolName;
  readonly operation: "ensure" | "publish" | "list" | "meta";
  readonly method: "POST" | "GET";
  readonly path: string;
  readonly command: "ensure" | "publish" | "list" | "meta";
}

export const ARTIFACT_SELECTION: readonly ArtifactSelectionEntry[] = [
  { tool: "artifacts_ensure", operation: "ensure", method: "POST", path: "/ensure", command: "ensure" },
  { tool: "artifacts_publish", operation: "publish", method: "POST", path: "/publish", command: "publish" },
  { tool: "artifacts_list", operation: "list", method: "POST", path: "/list", command: "list" },
  { tool: "artifacts_get", operation: "meta", method: "GET", path: "/meta/{artifactId}", command: "meta" },
];

export const ARTIFACT_LIMITS = {
  filesMin: 1,
  filesMax: 32,
  decodedBytesPerFile: 262144,
  decodedBytesTotal: 262144,
  bindingNameMin: 1,
  bindingNameMax: 128,
  callerKeyMaxUtf16: 256,
  listLimitMin: 1,
  listLimitMax: 100,
  listLimitDefault: 20,
  listOffsetMin: 0,
  listOffsetDefault: 0,
} as const;

export const ARTIFACT_MIME_TYPES: readonly string[] = [
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
];

export const ARTIFACT_RESERVED_FIRST_SEGMENTS: readonly string[] = [
  "api",
  "__artifacts",
  "livez",
  "health",
];

export const ARTIFACT_FORBIDDEN_CALLER_FIELDS: readonly string[] = [
  "actor",
  "owner",
  "tenant",
  "storageScope",
  "internalIdempotencyKey",
  "paramsHash",
];

export const ARTIFACT_EFFECTIVE_REQUIRED: Record<ArtifactToolName, readonly string[]> = {
  artifacts_ensure: ["bindingName", "idempotencyKey"],
  artifacts_publish: ["artifactId", "files", "idempotencyKey"],
  artifacts_list: [],
  artifacts_get: ["artifactId"],
};

export const ARTIFACT_DURABLE_IDENTITY = {
  internalKey: "SHA-256 UTF-8(storageScope | sub | operation | artifactIdOrEmpty | originalCallerKey)",
  paramsHash: "effective command after scope binding, defaults, text-to-byte conversion and forced provenance; object keys sorted, array order significant",
  conflict: "same key with changed effective content is a conflict and creates no new release",
  payloadHashInKey: false,
} as const;

/** Detached effective profile; every field participates in candidate integrity. */
export function artifactEffectiveProfile() {
  return {
    artifacts_ensure: {
      required: [...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_ensure],
      bindingName: { minLength: ARTIFACT_LIMITS.bindingNameMin, maxLength: ARTIFACT_LIMITS.bindingNameMax },
      parameters: { allowed: "empty-object-only" },
      storageScope: "server-owned trusted configuration",
    },
    artifacts_publish: {
      required: [...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_publish],
      artifactId: "lowercase UUID validated by the library",
      profile: { shape: "flat primitive record", default: {} },
      provenance: { fixed: "inline-original" },
      files: {
        minCount: ARTIFACT_LIMITS.filesMin,
        maxCount: ARTIFACT_LIMITS.filesMax,
        maxDecodedBytesPerFile: ARTIFACT_LIMITS.decodedBytesPerFile,
        maxDecodedBytesTotal: ARTIFACT_LIMITS.decodedBytesTotal,
        entry: "path plus mimeType plus exactly one of text or bytes",
        textEncoding: "UTF-8 bytes",
        byteRange: "integers 0 through 255",
        mimeTypes: [...ARTIFACT_MIME_TYPES],
        paths: "unique canonical paths; no empty or traversal segments, backslashes, percent-encoding, query or fragment markers",
        reservedFirstSegments: [...ARTIFACT_RESERVED_FIRST_SEGMENTS],
      },
    },
    artifacts_list: {
      required: [...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_list],
      limit: {
        minimum: ARTIFACT_LIMITS.listLimitMin,
        maximum: ARTIFACT_LIMITS.listLimitMax,
        default: ARTIFACT_LIMITS.listLimitDefault,
      },
      offset: { minimum: ARTIFACT_LIMITS.listOffsetMin, default: ARTIFACT_LIMITS.listOffsetDefault },
      note: "Authorization precedes pagination.",
    },
    artifacts_get: {
      required: [...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_get],
      artifactId: "lowercase UUID validated by the library",
    },
    closedArguments: [...ARTIFACT_FORBIDDEN_CALLER_FIELDS],
    callerKey: {
      type: "string",
      rule: `trimmed value is nonempty; original holds at most ${ARTIFACT_LIMITS.callerKeyMaxUtf16} UTF-16 code units and is preserved verbatim`,
    },
  };
}

export type ProviderContractStatus = "immo-artifacts.v1" | "artifacts-profile/v1" |
  "artifacts-commit/v1" | "artifacts-outcome/v1";

export interface RequiredProviderContracts {
  readonly capabilitySelection: ProviderContractStatus;
  readonly effectiveProfile: ProviderContractStatus;
  readonly durableCommandIdentity: ProviderContractStatus;
  readonly finalizationAuthorization: ProviderContractStatus;
  readonly typedFailure: ProviderContractStatus;
}

export const REQUIRED_PROVIDER_CONTRACTS: RequiredProviderContracts = {
  capabilitySelection: "artifacts-profile/v1",
  effectiveProfile: "immo-artifacts.v1",
  durableCommandIdentity: "immo-artifacts.v1",
  finalizationAuthorization: "artifacts-commit/v1",
  typedFailure: "artifacts-outcome/v1",
};

export function isArtifactToolName(name: string): name is ArtifactToolName {
  return (ARTIFACT_TOOL_NAMES as readonly string[]).includes(name);
}

/** Caller-key rule: string, trimmed nonempty, original at most 256 UTF-16 units. */
export function validateCallerKey(value: unknown): string[] {
  if (typeof value !== "string") return ["idempotencyKey must be a string"];
  if (value.trim() === "") return ["idempotencyKey must not be blank"];
  if (value.length > ARTIFACT_LIMITS.callerKeyMaxUtf16) {
    return ["idempotencyKey exceeds 256 UTF-16 code units"];
  }
  return [];
}

export function validateListPagination(limit: unknown, offset: unknown): string[] {
  const violations: string[] = [];
  if (limit !== undefined) {
    if (typeof limit !== "number" || !Number.isInteger(limit) ||
      limit < ARTIFACT_LIMITS.listLimitMin || limit > ARTIFACT_LIMITS.listLimitMax) {
      violations.push("limit must be an integer between 1 and 100");
    }
  }
  if (offset !== undefined) {
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < ARTIFACT_LIMITS.listOffsetMin) {
      violations.push("offset must be a nonnegative integer");
    }
  }
  return violations;
}
