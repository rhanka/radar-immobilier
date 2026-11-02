import {
  composeArtifactHost, createArtifactControl, createArtifactsPool,
  resolveArtifactsStorageConfig, type ArtifactsConfigInput, type ArtifactsPoolParams,
  createArtifactAdmissionAuthority, readActivationEnv, resolveActivationConfig,
  ARTIFACT_P0B, createDeleteConfirmation,
} from "@radar/artifacts-host";
import type { AuthConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { ControlRouteDeps } from "./control-route.js";
import { createStoredReader } from "./reader-storage.js";

export async function startArtifactControl(options: {
  input: ArtifactsConfigInput;
  auth: AuthConfig;
  contentBase?: string | undefined;
  poolParams: ArtifactsPoolParams;
  logger: Pick<Logger, "info" | "error">;
}): Promise<ControlRouteDeps | null> {
  const { auth, contentBase, logger } = options;
  let parsed;
  try {
    parsed = resolveArtifactsStorageConfig(options.input);
  } catch (err) {
    logger.error({ err }, "invalid ARTIFACTS_* config, refusing to start");
    return process.exit(1);
  }
  if (!parsed.enabled || !auth.enabled) {
    logger.info({ reason: parsed.enabled ? "auth_disabled" : parsed.reason,
      ...(!parsed.enabled && parsed.missing ? { missing: parsed.missing } : {}) },
    "artifact control disabled");
    return null;
  }
  const pool = createArtifactsPool(options.poolParams);
  try {
    if (!contentBase) throw new Error("artifact content base disabled");
    const readActivation = () => resolveActivationConfig(readActivationEnv());
    const confirmation = ARTIFACT_P0B ? createDeleteConfirmation(pool, parsed.storageScope, auth.appBaseUrl) : undefined;
    const host = await composeArtifactHost(pool, parsed, undefined, { readActivation, contentBase,
      ...(confirmation ? { confirmation } : {}) });
    const backend = createArtifactControl(host, parsed.storageScope, contentBase,
      createArtifactAdmissionAuthority(pool, readActivation, parsed.storageScope));
    logger.info({ storageScope: parsed.storageScope, s3Bucket: parsed.s3Bucket }, "artifact control enabled");
    return { auth, accounts: pool, backend, readActivation, storageScope: parsed.storageScope,
      ...(confirmation ? { confirmation } : {}),
      readerStorage: createStoredReader(pool, parsed.storageScope, contentBase, host.blobs) };
  } catch (err) {
    logger.error({ err }, "artifact control unavailable; API remains available");
    return { auth, accounts: pool };
  }
}
