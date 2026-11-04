import { ARTIFACTS_PROVIDER_VERSION, compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from "@sentropic/artifacts/mcp-core";

/** Package qualification and deployment qualification are separate switches. */
export const ARTIFACT_PROVIDER_VERSION: string = ARTIFACTS_PROVIDER_VERSION;
export const ARTIFACT_P0B_VERSIONS: readonly string[] = Object.freeze(["0.2.5", "0.2.6", "0.3.0", "0.2.8", "0.2.9", "0.2.10", "0.2.12", "0.2.13"]);
export const ARTIFACT_P0B = ARTIFACT_P0B_VERSIONS.includes(ARTIFACT_PROVIDER_VERSION);
if (ARTIFACT_PROVIDER_VERSION !== "0.2.2" && !ARTIFACT_P0B) throw new Error("artifact_provider_version_unqualified");
export function artifactProfileDescriptor(env: NodeJS.ProcessEnv = process.env) {
  const revision = env.ARTIFACTS_PROFILE_REVISION ?? (ARTIFACT_P0B ? "immo-artifacts.p0b.v1" : "immo-artifacts.v1");
  if (revision !== "immo-artifacts.v1" && revision !== "immo-artifacts.p0b.v1" &&
    revision !== "immo-artifacts.cas.v2" && revision !== "immo-artifacts.v2") {
    throw new Error("artifact_profile_revision_unqualified");
  }
  const strict = revision === "immo-artifacts.cas.v2" || revision === "immo-artifacts.v2";
  if ((revision === "immo-artifacts.v1") !== !ARTIFACT_P0B) throw new Error("artifact_profile_provider_mismatch");
  if (strict && ARTIFACT_PROVIDER_VERSION !== "0.2.9" && ARTIFACT_PROVIDER_VERSION !== "0.2.10" && ARTIFACT_PROVIDER_VERSION !== "0.2.12" && ARTIFACT_PROVIDER_VERSION !== "0.2.13") {
    throw new Error("artifact_strict_provider_unqualified");
  }
  if (revision === "immo-artifacts.v2" &&
    (env.ARTIFACTS_INPUTS_QUALIFIED !== "true" || env.ARTIFACTS_RESULTS_QUALIFIED !== "true")) {
    throw new Error("artifact_switchovers_not_qualified");
  }
  return Object.freeze({ profileRevisionId: revision, requireExpectedCurrentReleaseId: strict,
    resultEnvelopeVersion: (revision === "immo-artifacts.v2" ? 2 : 1) as 1 | 2 });
}
export const ARTIFACT_PROFILE_DESCRIPTOR = artifactProfileDescriptor();
export const ARTIFACT_STRICT = ARTIFACT_PROFILE_DESCRIPTOR.requireExpectedCurrentReleaseId;
export const ARTIFACT_PART1 = ARTIFACT_PROFILE_DESCRIPTOR.resultEnvelopeVersion === 2;
export const BASE_ARTIFACT_TOOLS = ["artifacts_ensure", "artifacts_publish", "artifacts_list", "artifacts_get"] as const;
export const P0B_ARTIFACT_TOOLS = ["artifacts_get_source", "artifacts_set_access", "artifacts_delete"] as const;
/**
 * Files parity LOT 1 — upload channel (bytes outside the model): one signed
 * PUT session, one verified commit, one atomic bundle publication.
 */
export const UPLOAD_ARTIFACT_TOOLS = ["artifacts_create_upload", "artifacts_commit_upload", "artifacts_publish_bundle"] as const;
export const PART1_ARTIFACT_TOOLS = ["artifacts_list_versions", "artifacts_revert"] as const;
export const ACTIVE_ARTIFACT_TOOLS = Object.freeze([
  ...BASE_ARTIFACT_TOOLS, ...(ARTIFACT_P0B ? P0B_ARTIFACT_TOOLS : []),
  ...(ARTIFACT_P0B ? UPLOAD_ARTIFACT_TOOLS : []),
  ...(ARTIFACT_PART1 ? PART1_ARTIFACT_TOOLS : []),
]);
/**
 * Files parity LOT 1 — immo release ceilings (server maxima, never above):
 * 255 files per release, 16 MiB per file, 64 MiB per release. Inline budgets
 * stay at 256 KiB; only the uploaded-asset union may reach these ceilings.
 */
export const RELEASE_FILES_MAX = 255;
export const RELEASE_FILE_BYTES_MAX = 16 * 1024 * 1024;
export const RELEASE_TOTAL_BYTES_MAX = 64 * 1024 * 1024;

/**
 * Files parity LOT 1 — MIME allowlist: the four inline text types plus PNG,
 * JPEG, GIF, WebP, SVG and PDF. Binary types are magic-byte verified at
 * commit; SVG must be script/handler/external-reference free; declared types
 * are served with nosniff on the single-label content origin, sandbox on
 * SVG/PDF.
 */
export const HOST_MIME_TYPES: readonly string[] = Object.freeze([
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
]);
export function compileHostArtifactProfile(descriptor = ARTIFACT_PROFILE_DESCRIPTOR) {
  const p0b = descriptor.profileRevisionId !== "immo-artifacts.v1";
  return compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
    ...descriptor,
    rules: { ...RADAR_ARTIFACTS_PROFILE.rules, mimeTypes: [...HOST_MIME_TYPES] },
    selectedCapabilities: [...BASE_ARTIFACT_TOOLS,
      ...(p0b ? P0B_ARTIFACT_TOOLS : []),
      ...(p0b ? UPLOAD_ARTIFACT_TOOLS : []),
      ...(descriptor.resultEnvelopeVersion === 2 ? PART1_ARTIFACT_TOOLS : [])],
    operations: [...RADAR_ARTIFACTS_PROFILE.operations.map((entry) => entry.operation === "publish"
      ? { ...entry, limits: { ...entry.limits, releaseFilesMax: RELEASE_FILES_MAX,
        releaseFileBytesMax: RELEASE_FILE_BYTES_MAX, releaseTotalBytesMax: RELEASE_TOTAL_BYTES_MAX } }
      : entry), ...(ARTIFACT_P0B ? [
      // set_access (like lookup_people/list_access for wagon 3) already
      // ships in the RADAR profile operations; only the missing writers are
      // appended here, or compilation fails on the duplicate.
      { operation: "delete", limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
      { operation: "create_upload", limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
      { operation: "commit_upload", limits: { idempotencyKeyMaxUnits: 256 }, defaults: { profile: {} } },
      { operation: "publish_bundle", limits: { idempotencyKeyMaxUnits: 256 }, defaults: { profile: {} } },
    ] : [])],
    contractRevisions: { ...RADAR_ARTIFACTS_PROFILE.contractRevisions,
      ...(ARTIFACT_P0B ? { immo: descriptor.profileRevisionId } : {}) },
  });
}
export const HOST_ARTIFACT_PROFILE = compileHostArtifactProfile();

export const isArtifactMutation = (op: string): boolean => ["ensure", "publish", "revert", "set_access", "delete",
  // Files parity LOT 1: commit_upload stages bytes durably and publish_bundle
  // cuts a release; both carry an idempotencyKey. create_upload mints a
  // quota-bounded session only and stays read-like at this layer.
  "commit_upload", "publish_bundle"].includes(op);
export const isArtifactPublication = (op: string): boolean => ["ensure", "publish", "revert",
  "publish_bundle"].includes(op);

/** Defer CAS presence until after authorization and historical receipt lookup. Never fill it. */
export function validateArtifactInput(tool: string, args: unknown) {
  return HOST_ARTIFACT_PROFILE.validate(tool, args, undefined, { deferPrecondition: true });
}

export function artifactPublicSchema(tool: string, schema: Readonly<Record<string, unknown>>) {
  return tool === "artifacts_delete" && !ARTIFACT_STRICT ? { ...schema,
    required: (schema.required as string[]).filter((key) => key !== "expectedCurrentReleaseId") } : schema;
}
