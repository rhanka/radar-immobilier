import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { ARTIFACT_P0B, ARTIFACT_PROVIDER_VERSION, ARTIFACT_PROFILE_DESCRIPTOR, HOST_ARTIFACT_PROFILE } from "@radar/artifacts-host";
import { artifactEffectiveProfile, ARTIFACT_SELECTION, ARTIFACT_TOOL_SCOPES } from "./artifact-profile.js";

/** Independent deployment manifest; no defaults are inferred from caller arguments. */
export function readArtifactConfig(revision = ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId) {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../../config/${name}.json`, import.meta.url), "utf8"));
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
    provider: { ...base.provider, version: ARTIFACT_PROVIDER_VERSION },
    toolScopes: { ...base.toolScopes, ...extension.additionalToolScopes },
    selection: [...base.selection, ...(extension.additionalSelection ?? [])],
    effectiveProfile,
    requiredContracts: { ...base.requiredContracts, effectiveProfile: extension.descriptor.profileRevisionId,
      durableCommandIdentity: extension.descriptor.profileRevisionId } };
}

export function assertArtifactAssembly(config = readArtifactConfig()) {
  if (!ARTIFACT_P0B) return;
  if (!isDeepStrictEqual(config.effectiveProfile, artifactEffectiveProfile()) ||
    !isDeepStrictEqual(config.selection, ARTIFACT_SELECTION) ||
    !isDeepStrictEqual(config.toolScopes, ARTIFACT_TOOL_SCOPES) ||
    !isDeepStrictEqual(config.effectiveProfile.descriptor, ARTIFACT_PROFILE_DESCRIPTOR) ||
    HOST_ARTIFACT_PROFILE.profileRevisionId !== ARTIFACT_PROFILE_DESCRIPTOR.profileRevisionId ||
    HOST_ARTIFACT_PROFILE.resultEnvelopeVersion !== ARTIFACT_PROFILE_DESCRIPTOR.resultEnvelopeVersion ||
    HOST_ARTIFACT_PROFILE.requireExpectedCurrentReleaseId !== ARTIFACT_PROFILE_DESCRIPTOR.requireExpectedCurrentReleaseId) {
    throw new Error("artifact_profile_assembly_incoherent");
  }
}
