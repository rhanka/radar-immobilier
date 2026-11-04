import { ARTIFACTS_PROVIDER_VERSION, compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from "@sentropic/artifacts/mcp-core";

/** Package qualification and deployment qualification are separate switches. */
export const ARTIFACT_PROVIDER_VERSION: string = ARTIFACTS_PROVIDER_VERSION;
export const ARTIFACT_P0B_VERSIONS: readonly string[] = Object.freeze(["0.2.5", "0.2.6", "0.3.0", "0.2.8", "0.2.9", "0.2.10", "0.2.12"]);
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
  if (strict && ARTIFACT_PROVIDER_VERSION !== "0.2.9" && ARTIFACT_PROVIDER_VERSION !== "0.2.10" && ARTIFACT_PROVIDER_VERSION !== "0.2.12") {
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
export const PART1_ARTIFACT_TOOLS = ["artifacts_list_versions", "artifacts_revert"] as const;
export const ACTIVE_ARTIFACT_TOOLS = Object.freeze([
  ...BASE_ARTIFACT_TOOLS, ...(ARTIFACT_P0B ? P0B_ARTIFACT_TOOLS : []),
  ...(ARTIFACT_PART1 ? PART1_ARTIFACT_TOOLS : []),
]);
export function compileHostArtifactProfile(descriptor = ARTIFACT_PROFILE_DESCRIPTOR) {
  return compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
    ...descriptor,
    selectedCapabilities: [...BASE_ARTIFACT_TOOLS,
      ...(descriptor.profileRevisionId !== "immo-artifacts.v1" ? P0B_ARTIFACT_TOOLS : []),
      ...(descriptor.resultEnvelopeVersion === 2 ? PART1_ARTIFACT_TOOLS : [])],
    operations: [...RADAR_ARTIFACTS_PROFILE.operations, ...(ARTIFACT_P0B ? [
      { operation: "set_access", limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
      { operation: "delete", limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
    ] : [])],
    contractRevisions: { ...RADAR_ARTIFACTS_PROFILE.contractRevisions,
      ...(ARTIFACT_P0B ? { immo: descriptor.profileRevisionId } : {}) },
  });
}
export const HOST_ARTIFACT_PROFILE = compileHostArtifactProfile();

export const isArtifactMutation = (op: string): boolean => ["ensure", "publish", "revert", "set_access", "delete"].includes(op);
export const isArtifactPublication = (op: string): boolean => ["ensure", "publish", "revert"].includes(op);

/** Defer CAS presence until after authorization and historical receipt lookup. Never fill it. */
export function validateArtifactInput(tool: string, args: unknown) {
  return HOST_ARTIFACT_PROFILE.validate(tool, args, undefined, { deferPrecondition: true });
}

export function artifactPublicSchema(tool: string, schema: Readonly<Record<string, unknown>>) {
  return tool === "artifacts_delete" && !ARTIFACT_STRICT ? { ...schema,
    required: (schema.required as string[]).filter((key) => key !== "expectedCurrentReleaseId") } : schema;
}
