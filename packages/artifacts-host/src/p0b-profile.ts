import { ARTIFACTS_PROVIDER_VERSION, compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from "@sentropic/artifacts/mcp-core";

/** The installed, centrally pinned package is the only activation switch. */
export const ARTIFACT_PROVIDER_VERSION: string = ARTIFACTS_PROVIDER_VERSION;
if (!["0.2.2", "0.3.0"].includes(ARTIFACT_PROVIDER_VERSION)) throw new Error("artifact_provider_version_unqualified");
export const ARTIFACT_P0B = ARTIFACT_PROVIDER_VERSION === "0.3.0";
export const ARTIFACT_PROFILE_DESCRIPTOR = Object.freeze({
  profileRevisionId: ARTIFACT_P0B ? "immo-artifacts.p0b.v1" : "immo-artifacts.v1",
  requireExpectedCurrentReleaseId: false,
  resultEnvelopeVersion: 1,
} as const);
export const BASE_ARTIFACT_TOOLS = ["artifacts_ensure", "artifacts_publish", "artifacts_list", "artifacts_get"] as const;
export const P0B_ARTIFACT_TOOLS = ["artifacts_get_source", "artifacts_set_access", "artifacts_delete"] as const;
export const ACTIVE_ARTIFACT_TOOLS = Object.freeze([
  ...BASE_ARTIFACT_TOOLS, ...(ARTIFACT_P0B ? P0B_ARTIFACT_TOOLS : []),
]);
export const HOST_ARTIFACT_PROFILE = compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
  selectedCapabilities: ACTIVE_ARTIFACT_TOOLS,
  operations: [...RADAR_ARTIFACTS_PROFILE.operations, ...(ARTIFACT_P0B ? [
    { operation: "get_source", limits: {}, defaults: {} },
    { operation: "set_access", limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
    { operation: "delete", limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
  ] : [])],
  contractRevisions: { ...RADAR_ARTIFACTS_PROFILE.contractRevisions,
    immo: ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId },
});

export const isArtifactMutation = (op: string): boolean => ["ensure", "publish", "set_access", "delete"].includes(op);
export const isArtifactPublication = (op: string): boolean => ["ensure", "publish"].includes(op);

/** Input validation uses a placeholder only; dispatch resolves omitted snapshots on the host. */
export function validateArtifactInput(tool: string, args: unknown) {
  const input = tool === "artifacts_delete" && args && typeof args === "object" && !Array.isArray(args) &&
    !Object.hasOwn(args, "expectedCurrentReleaseId") ? { ...args, expectedCurrentReleaseId: null } : args;
  return HOST_ARTIFACT_PROFILE.validate(tool, input);
}

export function artifactPublicSchema(tool: string, schema: Readonly<Record<string, unknown>>) {
  return tool === "artifacts_delete" ? { ...schema,
    required: (schema.required as string[]).filter((key) => key !== "expectedCurrentReleaseId") } : schema;
}
