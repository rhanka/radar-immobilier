import { compileArtifactsProfile, FROZEN_CAPABILITIES } from "./artifacts-provider-contract.helpers.js";

/** Supply the final profile to legacy-composition probes without changing runtime code. */
export async function withCandidateProfile<T extends { createHttpArtifactApp: (...args: never[]) => unknown }>(
  provider: T,
): Promise<T> {
  if (process.env.ARTIFACTS_PROVIDER_ACCEPTANCE !== "1") return provider;
  const profile = await compileArtifactsProfile({ selectedCapabilities: FROZEN_CAPABILITIES });
  return { ...provider, createHttpArtifactApp: (deps: object) =>
    provider.createHttpArtifactApp({ ...deps, profile } as never) };
}
