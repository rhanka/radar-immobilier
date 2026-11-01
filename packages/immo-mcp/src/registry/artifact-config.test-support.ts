import { readFileSync } from "node:fs";
import { ARTIFACT_P0B } from "@radar/artifacts-host";

/** Independently declared JSON contract, selected by the installed package. */
export function readArtifactConfig() {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../../config/${name}.json`, import.meta.url), "utf8"));
  const base = read("immo-artifacts.v1");
  if (!ARTIFACT_P0B) return base;
  const extension = read("immo-artifacts.p0b.v1");
  return { ...base, configVersion: extension.descriptor.profileRevisionId,
    provider: { ...base.provider, version: extension.providerVersion },
    toolScopes: { ...base.toolScopes, ...extension.additionalToolScopes },
    selection: [...base.selection, ...extension.additionalSelection],
    effectiveProfile: { ...base.effectiveProfile, ...extension.additionalEffectiveProfile, descriptor: extension.descriptor },
    requiredContracts: { ...base.requiredContracts, effectiveProfile: extension.descriptor.profileRevisionId,
      durableCommandIdentity: extension.descriptor.profileRevisionId } };
}
