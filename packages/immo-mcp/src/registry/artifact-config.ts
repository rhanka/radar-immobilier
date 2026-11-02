import { isDeepStrictEqual } from "node:util";
import { ARTIFACT_P0B, ARTIFACT_PROVIDER_VERSION, ARTIFACT_PROFILE_DESCRIPTOR, HOST_ARTIFACT_PROFILE, POLICY_REVISION } from "@radar/artifacts-host";
import { artifactEffectiveProfile, ARTIFACT_SELECTION, ARTIFACT_TOOL_SCOPES, ARTIFACT_INVOCATION_SCOPES, REQUIRED_PROVIDER_CONTRACTS } from "./artifact-profile.js";
import immoArtifactsV1 from "../../config/immo-artifacts.v1.json" with { type: "json" };
import immoArtifactsP0bV1 from "../../config/immo-artifacts.p0b.v1.json" with { type: "json" };
import immoArtifactsCasV2 from "../../config/immo-artifacts.cas.v2.json" with { type: "json" };
import immoArtifactsV2 from "../../config/immo-artifacts.v2.json" with { type: "json" };

/**
 * Static JSON imports (inlined by the esbuild image bundle, resolved by tsx/vitest
 * and tsc alike) keyed by revision id: no runtime path depends on the module's
 * on-disk depth, which differs between src/, dist/registry/ and the bundled dist/.
 */
const ARTIFACT_CONFIG_REVISIONS: Readonly<Record<string, unknown>> = Object.freeze({
  "immo-artifacts.v1": immoArtifactsV1,
  "immo-artifacts.p0b.v1": immoArtifactsP0bV1,
  "immo-artifacts.cas.v2": immoArtifactsCasV2,
  "immo-artifacts.v2": immoArtifactsV2,
});

/** Independent deployment manifest; no defaults are inferred from caller arguments. */
export function readArtifactConfig(revision = ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId): ReturnType<typeof JSON.parse> {
  const read = (name: string) => {
    if (!Object.hasOwn(ARTIFACT_CONFIG_REVISIONS, name)) throw new Error(`artifact_config_revision_unknown: ${name}`);
    // Fresh copy per read, as JSON.parse(readFileSync(...)) gave: callers never share mutable state.
    return structuredClone(ARTIFACT_CONFIG_REVISIONS[name]) as ReturnType<typeof JSON.parse>;
  };
  if (revision === "immo-artifacts.v1") return read("immo-artifacts.v1");
  const extension = read(revision);
  const base = readArtifactConfig(extension.extends.replace(/\.json$/, ""));
  if (!extension.providerVersion.split(" || ").includes(ARTIFACT_PROVIDER_VERSION)) {
    throw new Error("artifact_config_provider_version_unqualified");
  }
  const effectiveProfile = { ...base.effectiveProfile, ...extension.additionalEffectiveProfile, descriptor: extension.descriptor };
  for (const [tool, required] of Object.entries(extension.effectiveRequired ?? {})) {
    effectiveProfile[tool] = { ...effectiveProfile[tool], required };
  }
  return { ...base, configVersion: extension.descriptor.profileRevisionId,
    policyRevision: extension.policyRevision ?? base.policyRevision,
    provider: { ...base.provider, version: ARTIFACT_PROVIDER_VERSION },
    toolScopes: { ...base.toolScopes, ...extension.additionalToolScopes },
    selection: [...base.selection, ...(extension.additionalSelection ?? [])],
    effectiveProfile,
    requiredContracts: { ...base.requiredContracts, effectiveProfile: extension.descriptor.profileRevisionId,
      durableCommandIdentity: extension.descriptor.profileRevisionId } };
}

export function assertArtifactAssembly(config = readArtifactConfig()) {
  if (!ARTIFACT_P0B) return;
  if (config.configVersion !== ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId || config.policyRevision !== POLICY_REVISION ||
    !isDeepStrictEqual(config.invocationScopes, ARTIFACT_INVOCATION_SCOPES) ||
    !isDeepStrictEqual(config.requiredContracts, REQUIRED_PROVIDER_CONTRACTS) ||
    !isDeepStrictEqual(config.effectiveProfile, artifactEffectiveProfile()) ||
    !isDeepStrictEqual(config.selection, ARTIFACT_SELECTION) ||
    !isDeepStrictEqual(config.toolScopes, ARTIFACT_TOOL_SCOPES) ||
    !isDeepStrictEqual(config.effectiveProfile.descriptor, ARTIFACT_PROFILE_DESCRIPTOR) ||
    HOST_ARTIFACT_PROFILE.profileRevisionId !== ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId ||
    HOST_ARTIFACT_PROFILE.resultEnvelopeVersion !== ARTIFACT_PROFILE_DESCRIPTOR.resultEnvelopeVersion ||
    HOST_ARTIFACT_PROFILE.requireExpectedCurrentReleaseId !== ARTIFACT_PROFILE_DESCRIPTOR.requireExpectedCurrentReleaseId) {
    throw new Error("artifact_profile_assembly_incoherent");
  }
}
