import { ARTIFACTS_PROVIDER_VERSION, compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from "@sentropic/artifacts/mcp-core";
import { gitProfileOperations, resolveGitMode, type GitArtifactTool } from "./git-mode/flag.js";

/** Package qualification and deployment qualification are separate switches. */
export const ARTIFACT_PROVIDER_VERSION: string = ARTIFACTS_PROVIDER_VERSION;
export const ARTIFACT_P0B_VERSIONS: readonly string[] = Object.freeze(["0.2.5", "0.2.6", "0.2.8", "0.2.9", "0.2.10", "0.2.12", "0.2.13", "0.2.15", "0.2.16", "0.2.17", "0.2.18", "0.2.20", "0.2.22", "0.2.23"]);
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
  if (strict && ARTIFACT_PROVIDER_VERSION !== "0.2.9" && ARTIFACT_PROVIDER_VERSION !== "0.2.10" && ARTIFACT_PROVIDER_VERSION !== "0.2.12" && ARTIFACT_PROVIDER_VERSION !== "0.2.13" && ARTIFACT_PROVIDER_VERSION !== "0.2.15" && ARTIFACT_PROVIDER_VERSION !== "0.2.16" && ARTIFACT_PROVIDER_VERSION !== "0.2.17" && ARTIFACT_PROVIDER_VERSION !== "0.2.18" && ARTIFACT_PROVIDER_VERSION !== "0.2.20" && ARTIFACT_PROVIDER_VERSION !== "0.2.22" && ARTIFACT_PROVIDER_VERSION !== "0.2.23") {
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
/**
 * Files parity LOT 2 — browser upload pages and asset-first publication:
 * owner-only page mint, staged-vs-released asset listing, and the v2 bundle
 * (copy/carry/keep asset forms) beside the v1 union.
 */
export const UPLOAD_PAGE_ARTIFACT_TOOLS = ["artifacts_create_upload_page", "artifacts_list_assets", "artifacts_publish_bundle_v2"] as const;
/**
 * I2 on G2 — share tooling through the I2 seams: opaque directory lookup
 * and access listing (set_access semantics already ride the G1 mirror).
 * The directory port is mandatory for these tools; without it they answer
 * capability_unavailable instead of leaking resolution.
 */
export const SHARING_ARTIFACT_TOOLS = ["artifacts_lookup_people", "artifacts_list_access"] as const;
export const PART1_ARTIFACT_TOOLS = ["artifacts_list_versions", "artifacts_revert"] as const;
/**
 * Reader consent — self-revocation of the durable baskets consent through
 * the generic host port (`readerConsent` on the provider app). The baskets
 * screen (grant) and the Gate B check (live row plus fresh rights) live in
 * the API reader flow; this tool only withdraws.
 */
export const CONSENT_ARTIFACT_TOOLS = ["artifacts_revoke_reader_consent"] as const;
/**
 * Git-backed artifact mode (IMMO_ARTIFACTS_GIT_MODE, default off). Off: no
 * git tool is selected and the profile is byte-identical to the flag-less
 * build. On: the stage tools the pinned provider routes; an unqualified
 * provider refuses at boot (git-mode/flag.ts).
 */
export const ARTIFACT_GIT_MODE = resolveGitMode(process.env, ARTIFACT_PROVIDER_VERSION);
export const GIT_MODE_ARTIFACT_TOOLS: readonly GitArtifactTool[] = ARTIFACT_GIT_MODE.tools;
export const ACTIVE_ARTIFACT_TOOLS = Object.freeze([
  ...BASE_ARTIFACT_TOOLS, ...(ARTIFACT_P0B ? P0B_ARTIFACT_TOOLS : []),
  ...(ARTIFACT_P0B ? UPLOAD_ARTIFACT_TOOLS : []),
  ...(ARTIFACT_P0B ? UPLOAD_PAGE_ARTIFACT_TOOLS : []),
  ...(ARTIFACT_P0B ? SHARING_ARTIFACT_TOOLS : []),
  ...(ARTIFACT_P0B ? CONSENT_ARTIFACT_TOOLS : []),
  ...(ARTIFACT_PART1 ? PART1_ARTIFACT_TOOLS : []),
  ...GIT_MODE_ARTIFACT_TOOLS,
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
  // Files parity LOT 2 — variable fonts and funnel videos ride the same
  // upload channel; both are magic-byte verified at commit and served with
  // the declared MIME type under nosniff.
  "font/woff2",
  "video/mp4",
]);
export function compileHostArtifactProfile(descriptor = ARTIFACT_PROFILE_DESCRIPTOR,
  gitTools: readonly GitArtifactTool[] = GIT_MODE_ARTIFACT_TOOLS) {
  const p0b = descriptor.profileRevisionId !== "immo-artifacts.v1";
  return compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
    ...descriptor,
    rules: { ...RADAR_ARTIFACTS_PROFILE.rules, mimeTypes: [...HOST_MIME_TYPES] },
    selectedCapabilities: [...BASE_ARTIFACT_TOOLS,
      ...(p0b ? P0B_ARTIFACT_TOOLS : []),
      ...(p0b ? UPLOAD_ARTIFACT_TOOLS : []),
      ...(p0b ? UPLOAD_PAGE_ARTIFACT_TOOLS : []),
      ...(p0b ? SHARING_ARTIFACT_TOOLS : []),
      ...(p0b ? CONSENT_ARTIFACT_TOOLS : []),
      ...(descriptor.resultEnvelopeVersion === 2 ? PART1_ARTIFACT_TOOLS : []),
      ...gitTools],
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
      // Files parity LOT 2 — page mint carries no idempotencyKey
      // (quota-bounded mint); the asset listing is a paginated read (same
      // page bounds as list); the v2 bundle is an idempotent writer like the
      // v1 union.
      { operation: "create_upload_page", limits: {}, defaults: {} },
      { operation: "list_assets", limits: { listAssetsLimitMin: 1, listAssetsLimitMax: 100 }, defaults: { limit: 20 } },
      { operation: "publish_bundle_v2", limits: { idempotencyKeyMaxUnits: 256 }, defaults: { profile: {} } },
      // Reader consent LOT 1 — self-revocation only; the provider operation
      // profile already declares the schema (artifactId, optional scope,
      // required idempotencyKey), the host only selects it.
      { operation: "revoke_reader_consent", limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
    ] : []),
    // Git mode: one operation entry per selected git tool, none when off.
    ...gitProfileOperations(gitTools.filter((tool) => !RADAR_ARTIFACTS_PROFILE.operations
      .some((entry) => entry.operation === tool.slice("artifacts_".length))))],
    contractRevisions: { ...RADAR_ARTIFACTS_PROFILE.contractRevisions,
      ...(ARTIFACT_P0B ? { immo: descriptor.profileRevisionId } : {}) },
  });
}
export const HOST_ARTIFACT_PROFILE = compileHostArtifactProfile();

export const isArtifactMutation = (op: string): boolean => ["ensure", "publish", "revert", "set_access", "delete",
  // Files parity LOT 1: commit_upload stages bytes durably and publish_bundle
  // cuts a release; both carry an idempotencyKey. create_upload mints a
  // quota-bounded session only and stays read-like at this layer.
  "commit_upload", "publish_bundle",
  // Files parity LOT 2: the v2 bundle is an idempotent writer; the page mint
  // stays read-like (quota-bounded session) and the asset listing is a read.
  "publish_bundle_v2",
  // Reader consent LOT 1: revocation is an idempotent writer (required
  // idempotencyKey, provider IDEMPOTENT_WRITERS).
  "revoke_reader_consent"].includes(op);
export const isArtifactPublication = (op: string): boolean => ["ensure", "publish", "revert",
  "publish_bundle", "publish_bundle_v2"].includes(op);

/** Defer CAS presence until after authorization and historical receipt lookup. Never fill it. */
export function validateArtifactInput(tool: string, args: unknown) {
  return HOST_ARTIFACT_PROFILE.validate(tool, args, undefined, { deferPrecondition: true });
}

export function artifactPublicSchema(tool: string, schema: Readonly<Record<string, unknown>>) {
  return tool === "artifacts_delete" && !ARTIFACT_STRICT ? { ...schema,
    required: (schema.required as string[]).filter((key) => key !== "expectedCurrentReleaseId") } : schema;
}
