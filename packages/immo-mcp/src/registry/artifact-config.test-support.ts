import { readFileSync } from "node:fs";
import { ARTIFACT_P0B, ARTIFACT_PROVIDER_VERSION } from "@radar/artifacts-host";

/** Independently declared JSON contract, selected by the installed package. */
export function readArtifactConfig() {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../../config/${name}.json`, import.meta.url), "utf8"));
  const base = read("immo-artifacts.v1");
  if (!ARTIFACT_P0B) return base;
  const extension = read("immo-artifacts.p0b.v1");
  if (!extension.providerVersion.split(" || ").includes(ARTIFACT_PROVIDER_VERSION)) {
    throw new Error("artifact_config_provider_version_unqualified");
  }
  return { ...base, configVersion: extension.descriptor.profileRevisionId,
    provider: { ...base.provider, version: ARTIFACT_PROVIDER_VERSION },
    toolScopes: { ...base.toolScopes, ...extension.additionalToolScopes },
    selection: [...base.selection, ...extension.additionalSelection],
    effectiveProfile: { ...base.effectiveProfile, ...extension.additionalEffectiveProfile, descriptor: extension.descriptor },
    requiredContracts: { ...base.requiredContracts, effectiveProfile: extension.descriptor.profileRevisionId,
      durableCommandIdentity: extension.descriptor.profileRevisionId } };
}
