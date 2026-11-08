/**
 * Effective H4 artifact profile shared by the embedded configuration and the
 * compatibility tests. Records the installed selection, the caller-visible
 * input bounds, the durable command-identity semantics and the provider
 * contract revisions required before activation.
 */

import { ACTIVE_ARTIFACT_TOOLS, ARTIFACT_PROFILE_DESCRIPTOR, ARTIFACT_P0B, ARTIFACT_STRICT, ARTIFACT_PART1,
  RELEASE_FILES_MAX, RELEASE_FILE_BYTES_MAX, RELEASE_TOTAL_BYTES_MAX, HOST_MIME_TYPES } from "@radar/artifacts-host";
export { ARTIFACT_PROVIDER_VERSION } from "@radar/artifacts-host";
import { GIT_EFFECTIVE_REQUIRED, gitEffectiveProfile, gitSelection, gitToolScope, type GitOperation } from "./artifact-git-profile.js";
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
  // Files parity LOT 1 — the upload channel publishes releases: write-only.
  artifacts_create_upload: ARTIFACT_WRITE_SCOPE,
  artifacts_commit_upload: ARTIFACT_WRITE_SCOPE,
  artifacts_publish_bundle: ARTIFACT_WRITE_SCOPE,
  // Files parity LOT 2 — page mint and v2 bundle publish: write-only; the
  // asset listing reads: read-only.
  artifacts_create_upload_page: ARTIFACT_WRITE_SCOPE,
  artifacts_list_assets: ARTIFACT_READ_SCOPE,
  artifacts_publish_bundle_v2: ARTIFACT_WRITE_SCOPE,
  // I2 on G2 — opaque directory lookup and access listing: read-only.
  artifacts_lookup_people: ARTIFACT_READ_SCOPE,
  artifacts_list_access: ARTIFACT_READ_SCOPE,
  // Reader consent LOT 1 — self-revocation withdraws the caller's own
  // consent: a state transition, write-scoped and idempotency-guarded.
  artifacts_revoke_reader_consent: ARTIFACT_WRITE_SCOPE,
  artifacts_list_versions: ARTIFACT_READ_SCOPE,
  artifacts_revert: ARTIFACT_WRITE_SCOPE,
  // Git mode (IMMO_ARTIFACTS_GIT_MODE): only selected git tools reach ARTIFACT_TOOL_SCOPES.
  artifacts_git_attach: gitToolScope("artifacts_git_attach"),
  artifacts_fetch_app_source: gitToolScope("artifacts_fetch_app_source"),
  artifacts_git_publish: gitToolScope("artifacts_git_publish"),
  artifacts_git_commit: gitToolScope("artifacts_git_commit"),
  artifacts_live_write: gitToolScope("artifacts_live_write"),
  artifacts_live_read: gitToolScope("artifacts_live_read"),
  artifacts_live_reset: gitToolScope("artifacts_live_reset"),
  artifacts_live_status: gitToolScope("artifacts_live_status"),
  artifacts_live_control: gitToolScope("artifacts_live_control"),
  artifacts_live_invite: gitToolScope("artifacts_live_invite"),
  artifacts_live_accept_invitation: gitToolScope("artifacts_live_accept_invitation"),
  artifacts_live_revoke_invitation: gitToolScope("artifacts_live_revoke_invitation"),
  artifacts_live_invitations: gitToolScope("artifacts_live_invitations"),
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
  readonly operation: "ensure" | "publish" | "list" | "meta" | "get_source" | "set_access" | "delete" | "create_upload" | "commit_upload" | "publish_bundle" | "create_upload_page" | "list_assets" | "publish_bundle_v2" | "lookup_people" | "list_access" | "revoke_reader_consent" | "list_versions" | "revert" | GitOperation;
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
    // Files parity LOT 1 — upload channel on the provider upload routes.
    { tool: "artifacts_create_upload", operation: "create_upload", method: "POST", path: "/uploads/create", command: "create_upload" },
    { tool: "artifacts_commit_upload", operation: "commit_upload", method: "POST", path: "/uploads/commit", command: "commit_upload" },
    { tool: "artifacts_publish_bundle", operation: "publish_bundle", method: "POST", path: "/publish_bundle", command: "publish_bundle" },
    // Files parity LOT 2 — browser page mint, asset listing, v2 bundle.
    { tool: "artifacts_create_upload_page", operation: "create_upload_page", method: "POST", path: "/uploads/page", command: "create_upload_page" },
    { tool: "artifacts_list_assets", operation: "list_assets", method: "POST", path: "/list_assets", command: "list_assets" },
    { tool: "artifacts_publish_bundle_v2", operation: "publish_bundle_v2", method: "POST", path: "/publish_bundle_v2", command: "publish_bundle_v2" },
    // I2 on G2 — opaque directory lookup and access listing.
    { tool: "artifacts_lookup_people", operation: "lookup_people", method: "POST", path: "/lookup_people", command: "lookup_people" },
    { tool: "artifacts_list_access", operation: "list_access", method: "POST", path: "/list_access", command: "list_access" },
    // Reader consent LOT 1 — self-revocation on the provider consent route.
    { tool: "artifacts_revoke_reader_consent", operation: "revoke_reader_consent", method: "POST", path: "/revoke_reader_consent", command: "revoke_reader_consent" },
  ] as const : []),
  ...(ARTIFACT_PART1 ? [
    { tool: "artifacts_list_versions", operation: "list_versions", method: "POST", path: "/list_versions", command: "list_versions" },
    { tool: "artifacts_revert", operation: "revert", method: "POST", path: "/revert", command: "revert" },
  ] as const : []),
  ...gitSelection(),
];

export const ARTIFACT_LIMITS = {
  filesMin: 1,
  filesMax: 32,
  decodedBytesPerFile: 262144,
  decodedBytesTotal: 262144,
  // Files parity LOT 1 — release budgets for the uploaded-asset union.
  releaseFilesMax: RELEASE_FILES_MAX,
  releaseFileBytesMax: RELEASE_FILE_BYTES_MAX,
  releaseTotalBytesMax: RELEASE_TOTAL_BYTES_MAX,
  bindingNameMin: 1,
  bindingNameMax: 128,
  callerKeyMaxUtf16: 256,
  listLimitMin: 1,
  listLimitMax: 100,
  listLimitDefault: 20,
  listOffsetMin: 0,
  listOffsetDefault: 0,
} as const;

export const ARTIFACT_MIME_TYPES: readonly string[] = [...HOST_MIME_TYPES];

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

const ALL_EFFECTIVE_REQUIRED: Record<ArtifactToolName, readonly string[]> = {
  artifacts_ensure: ["bindingName", "idempotencyKey"],
  artifacts_publish: ["artifactId", ...(!ARTIFACT_PART1 ? ["files"] : []), "idempotencyKey",
    ...(ARTIFACT_STRICT ? ["expectedCurrentReleaseId"] : [])],
  artifacts_list: [],
  artifacts_get: ["artifactId"],
  artifacts_get_source: ["artifactId"],
  artifacts_set_access: ["artifactId", "action", "principalId", "idempotencyKey"],
  artifacts_delete: ["artifactId", "idempotencyKey", ...(ARTIFACT_STRICT ? ["expectedCurrentReleaseId"] : [])],
  // Files parity LOT 1 — create_upload takes no idempotencyKey (quota-bounded
  // session mint); commit_upload and publish_bundle are idempotent writers.
  artifacts_create_upload: ["artifactId", "mimeType"],
  artifacts_commit_upload: ["artifactId", "uploadId", "path", "mimeType", "digest", "size", "idempotencyKey"],
  artifacts_publish_bundle: ["artifactId", "idempotencyKey", "expectedCurrentReleaseId"],
  // Files parity LOT 2 — page mint takes no idempotencyKey (quota-bounded,
  // one live token at a time); asset listing is a read; the v2 bundle is an
  // idempotent writer with the same guard as the v1 union.
  artifacts_create_upload_page: ["artifactId"],
  artifacts_list_assets: ["artifactId"],
  artifacts_publish_bundle_v2: ["artifactId", "idempotencyKey", "expectedCurrentReleaseId"],
  // I2 on G2 — query/limit (lookup) and artifactId (listing).
  artifacts_lookup_people: ["query"],
  artifacts_list_access: ["artifactId"],
  // Reader consent LOT 1 — revocation is an idempotent writer (required
  // idempotencyKey); scope names one consent scope, omitted revokes them all.
  artifacts_revoke_reader_consent: ["artifactId", "idempotencyKey"],
  artifacts_list_versions: ["artifactId"],
  artifacts_revert: ["artifactId", "targetReleaseId", "expectedCurrentReleaseId", "idempotencyKey"],
  ...GIT_EFFECTIVE_REQUIRED,
};
export const ARTIFACT_EFFECTIVE_REQUIRED = Object.fromEntries(ARTIFACT_TOOL_NAMES.map((name) =>
  [name, ALL_EFFECTIVE_REQUIRED[name]])) as Record<ArtifactToolName, readonly string[]>;

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
        // Files parity LOT 1 — release ceilings for the uploaded-asset union.
        releaseMaxFiles: ARTIFACT_LIMITS.releaseFilesMax,
        releaseMaxFileBytes: ARTIFACT_LIMITS.releaseFileBytesMax,
        releaseMaxTotalBytes: ARTIFACT_LIMITS.releaseTotalBytesMax,
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
      artifacts_set_access: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_set_access, grant: "read", principalId: "opaque userRef from artifacts_lookup_people; sentropic:platform sentinel grants platform read-only; never a sub or email" },
      artifacts_delete: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_delete, confirmation: "trusted app session; transactional consumption", terminal: true },
      // Files parity LOT 1 — outside-the-model bytes: signed PUT session,
      // verified commit, atomic bundle release (union of inline files and
      // staged/uploaded assets under the release ceilings above).
      artifacts_create_upload: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_create_upload,
        session: "signed PUT, exact content-length, exactly the announced requiredHeaders and nothing else, 10-minute URL, 24-hour session, 8 open sessions per principal" },
      artifacts_commit_upload: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_commit_upload,
        verification: "server re-reads staging and re-verifies size, digest and MIME before pinning" },
      artifacts_publish_bundle: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_publish_bundle,
        release: "atomic release from inline files plus staged assets; union under the release ceilings" },
      // Files parity LOT 2 — browser page mint for large-asset authors, asset
      // listing for staged-vs-released review, v2 bundle for copy/carry/keep.
      artifacts_create_upload_page: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_create_upload_page,
        page: "owner-only browser mint; bytes travel browser to storage, never through the model" },
      artifacts_list_assets: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_list_assets,
        listing: "staged rows are owner-only; released rows need the source right" },
      artifacts_publish_bundle_v2: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_publish_bundle_v2,
        release: "atomic release from inline files plus copy/carry/keep assets; union under the release ceilings" },
      // I2 on G2 — directory over approved accounts (opaque userRef), modes
      // restricted/platform, public refused; collab (source) stays a
      // single named-colleague right, never granted by catalogue tools.
      artifacts_lookup_people: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_lookup_people,
        directory: "approved IMMO accounts by name/email; results carry userRef plus masked email hint" },
      artifacts_list_access: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_list_access,
        projection: "access mode plus per-principal grants (userRef, masked email hint, grant, reason)" },
      // Reader consent — self-revocation of the baskets consent only; the next baskets call asks again.
      artifacts_revoke_reader_consent: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_revoke_reader_consent,
        self: "withdraws the caller's own consent for one scope, or for every scope when scope is omitted" },
    } : {}),
    ...(ARTIFACT_PART1 ? {
      artifacts_list_versions: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_list_versions },
      artifacts_revert: { required: ARTIFACT_EFFECTIVE_REQUIRED.artifacts_revert },
      metadata: ["title", "description", "icon"],
      contentSource: "exactly one of files or edits",
    } : {}),
    ...gitEffectiveProfile(),
    closedArguments: [...ARTIFACT_FORBIDDEN_CALLER_FIELDS],
    callerKey: {
      type: "string",
      rule: `trimmed value is nonempty; original holds at most ${ARTIFACT_LIMITS.callerKeyMaxUtf16} UTF-16 code units and is preserved verbatim`,
    },
  };
}

export type ProviderContractStatus = "immo-artifacts.v1" | "immo-artifacts.p0b.v1" |
  "immo-artifacts.cas.v2" | "immo-artifacts.v2" | "artifacts-profile/v1" |
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
