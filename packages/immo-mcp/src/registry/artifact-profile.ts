/**
 * Effective H4 artifact profile shared by the embedded configuration and the
 * compatibility tests. Records the installed selection, the caller-visible
 * input bounds, the durable command-identity semantics and the provider
 * contract revisions required before activation.
 */

import { ACTIVE_ARTIFACT_TOOLS, ARTIFACT_PROFILE_DESCRIPTOR, ARTIFACT_P0B } from "@radar/artifacts-host";
export { ARTIFACT_PROVIDER_VERSION } from "@radar/artifacts-host";
export const ARTIFACT_PROVIDER_ID = "sentropic.artifacts" as const;
export const ARTIFACT_PROFILE_REVISION = ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId;

export const ARTIFACT_TOOL_NAMES = ACTIVE_ARTIFACT_TOOLS;

export type ArtifactToolName = (typeof ARTIFACT_TOOL_NAMES)[number];

/**
 * Explicit artifact scopes, named after the repository convention
 * `immo:<resource>:<action>` (compare `immo:documents:read`, `immo:notes:write`).
 * Reading (list, get) and writing (ensure, publish) are consented separately:
 * `immo:read` alone never grants a write.
 */
export const ARTIFACT_READ_SCOPE = "immo:artifacts:read" as const;
export const ARTIFACT_WRITE_SCOPE = "immo:artifacts:write" as const;
export const ARTIFACT_INVOCATION_SCOPES = Object.freeze({
  read: ARTIFACT_READ_SCOPE,
  write: ARTIFACT_WRITE_SCOPE,
} as const);

/** Required scope per selected tool; the only source for manifest, registry and binding checks. */
const ALL_TOOL_SCOPES: Record<ArtifactToolName, string> = {
  artifacts_ensure: ARTIFACT_WRITE_SCOPE,
  artifacts_publish: ARTIFACT_WRITE_SCOPE,
  artifacts_list: ARTIFACT_READ_SCOPE,
  artifacts_get: ARTIFACT_READ_SCOPE,
  artifacts_get_source: ARTIFACT_READ_SCOPE,
  artifacts_set_access: ARTIFACT_WRITE_SCOPE,
  artifacts_delete: ARTIFACT_WRITE_SCOPE,
};
export const ARTIFACT_TOOL_SCOPES = Object.freeze(Object.fromEntries(
  ARTIFACT_TOOL_NAMES.map((name) => [name, ALL_TOOL_SCOPES[name]]))) as Readonly<Record<ArtifactToolName, string>>;

/**
 * Transition (owner decision 2026-10-31): while clients connected before the
 * explicit scopes existed still hold only `immo:read`, the flag
 * `IMMO_MCP_ARTIFACTS_LEGACY_READ_SCOPE=true` lets `immo:read` satisfy the
 * READ tools only. It never satisfies a write tool. Default: off (strict).
 */
export const ARTIFACT_LEGACY_READ_SCOPE = "immo:read" as const;
export const ARTIFACT_LEGACY_READ_FLAG = "IMMO_MCP_ARTIFACTS_LEGACY_READ_SCOPE" as const;

export interface ArtifactScopePolicy {
  /** When true, `immo:read` also satisfies `immo:artifacts:read` (transition only). */
  readonly legacyReadScope: boolean;
}

export const STRICT_ARTIFACT_SCOPE_POLICY: ArtifactScopePolicy = Object.freeze({ legacyReadScope: false });

/** Parse the transition flag; anything other than unset, "true" or "false" is a configuration error. */
export function readArtifactScopePolicy(env: NodeJS.ProcessEnv): ArtifactScopePolicy {
  const raw = env[ARTIFACT_LEGACY_READ_FLAG]?.trim();
  if (raw === undefined || raw === "" || raw === "false") return STRICT_ARTIFACT_SCOPE_POLICY;
  if (raw === "true") return Object.freeze({ legacyReadScope: true });
  throw new Error("artifact_legacy_read_scope_invalid");
}

/** Scopes, any one of which satisfies the tool under the given policy. */
export function acceptedArtifactScopes(tool: ArtifactToolName, policy: ArtifactScopePolicy): readonly string[] {
  const required = ARTIFACT_TOOL_SCOPES[tool];
  return (tool === "artifacts_get" || tool === "artifacts_list") && policy.legacyReadScope
    ? [required, ARTIFACT_LEGACY_READ_SCOPE] : [required];
}

export function hasArtifactScope(tool: ArtifactToolName, scopes: readonly string[],
  policy: ArtifactScopePolicy): boolean {
  return acceptedArtifactScopes(tool, policy).some((scope) => scopes.includes(scope));
}

export interface ArtifactSelectionEntry {
  readonly tool: ArtifactToolName;
  readonly operation: "ensure" | "publish" | "list" | "meta" | "get_source" | "set_access" | "delete";
  readonly method: "POST" | "GET";
  readonly path: string;
  readonly command: ArtifactSelectionEntry["operation"];
}

export const ARTIFACT_SELECTION: readonly ArtifactSelectionEntry[] = [
  { tool: "artifacts_ensure", operation: "ensure", method: "POST", path: "/ensure", command: "ensure" },
  { tool: "artifacts_publish", operation: "publish", method: "POST", path: "/publish", command: "publish" },
  { tool: "artifacts_list", operation: "list", method: "POST", path: "/list", command: "list" },
  { tool: "artifacts_get", operation: "meta", method: "GET", path: "/meta/{artifactId}", command: "meta" },
  ...(ARTIFACT_P0B ? [
    { tool: "artifacts_get_source", operation: "get_source", method: "POST", path: "/get_source", command: "get_source" },
    { tool: "artifacts_set_access", operation: "set_access", method: "POST", path: "/set_access", command: "set_access" },
    { tool: "artifacts_delete", operation: "delete", method: "POST", path: "/delete", command: "delete" },
  ] as const : []),
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
  ...(ARTIFACT_P0B ? { artifacts_get_source: ["artifactId"],
    artifacts_set_access: ["artifactId", "action", "principalId", "idempotencyKey"],
    artifacts_delete: ["artifactId", "idempotencyKey"] } : {}),
} as Record<ArtifactToolName, readonly string[]>;

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
    ...(ARTIFACT_P0B ? {
      descriptor: ARTIFACT_PROFILE_DESCRIPTOR,
      artifacts_get_source: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_get_source, maxFiles: 32, maxTotalBytes: 262144 },
      artifacts_set_access: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_set_access, grant: "read", principalId: "approved IMMO account IdP sub" },
      artifacts_delete: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_delete, confirmation: "trusted app session; transactional consumption", terminal: true },
    } : {}),
    closedArguments: [...ARTIFACT_FORBIDDEN_CALLER_FIELDS],
    callerKey: {
      type: "string",
      rule: `trimmed value is nonempty; original holds at most ${ARTIFACT_LIMITS.callerKeyMaxUtf16} UTF-16 code units and is preserved verbatim`,
    },
  };
}

export type ProviderContractStatus = "immo-artifacts.v1" | "immo-artifacts.p0b.v1" | "artifacts-profile/v1" |
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
  effectiveProfile: ARTIFACT_PROFILE_REVISION,
  durableCommandIdentity: ARTIFACT_PROFILE_REVISION,
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
