import {
  composeArtifactHost, createAccountDirectory, createArtifactControl, createArtifactsPool,
  resolveArtifactsStorageConfig, type ArtifactsConfigInput, type ArtifactsPoolParams,
  createArtifactAdmissionAuthority, readActivationEnv, resolveActivationConfig,
  ARTIFACT_P0B, createDeleteConfirmation, type UploadPageRouteConfig,
} from "@radar/artifacts-host";
import type { AuthConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { ControlRouteDeps } from "./control-route.js";
import type { UploadPageService } from "@sentropic/artifacts/server/upload-page";
import { createReaderConsentService } from "./reader-consent.js";
import { createStoredReader } from "./reader-storage.js";

/**
 * Files parity LOT 2 — browser upload page wiring. The page cookie secret is
 * a dedicated secret (never the session secret): it signs the
 * single-exchange `__Host-` page cookie only. Absent or short under P0B, the
 * control plane stays closed with an explicit log — the provider requires
 * this wiring as soon as the page mint capability is selected.
 */
function readUploadPageWiring(auth: AuthConfig, s3Endpoint: string): UploadPageRouteConfig | null {
  if (!ARTIFACT_P0B) return null;
  const secret = (process.env["ARTIFACTS_UPLOAD_PAGE_SECRET"] ?? "").trim();
  if (secret.length < 32) return null;
  let s3Origins: readonly string[] = [];
  try {
    const origin = new URL(s3Endpoint).origin;
    if (origin.startsWith("https://")) s3Origins = [origin];
  } catch { s3Origins = []; }
  return { cookieSecret: secret, controlOrigin: auth.appBaseUrl,
    pageBaseUrl: `${auth.appBaseUrl.replace(/\/$/, "")}/api/v1`, s3Origins };
}

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
    const uploadPage = readUploadPageWiring(auth, parsed.s3Endpoint);
    if (ARTIFACT_P0B && !uploadPage) throw new Error("artifact upload page secret missing (ARTIFACTS_UPLOAD_PAGE_SECRET)");
    const host = await composeArtifactHost(pool, parsed, undefined, { readActivation, contentBase,
      ...(confirmation ? { confirmation } : {}),
      ...(uploadPage ? { uploadPage } : {}) });
    const backend = createArtifactControl(host, parsed.storageScope, contentBase,
      createArtifactAdmissionAuthority(pool, readActivation, parsed.storageScope),
      { directory: createAccountDirectory(pool) });
    logger.info({ storageScope: parsed.storageScope, s3Bucket: parsed.s3Bucket }, "artifact control enabled");
    const composed = host as typeof host & { uploadPageService?: UploadPageService;
      uploadPageConfig?: { controlOrigin: string; s3Origins: readonly string[] } };
    return { auth, accounts: pool, backend, readActivation, storageScope: parsed.storageScope,
      ...(confirmation ? { confirmation } : {}),
      // Browser upload page (LOT 2): same ledger as the provider, mounted on
      // the control origin with the control session rules.
      ...(composed.uploadPageService && composed.uploadPageConfig ? { uploadPage: {
        service: composed.uploadPageService,
        config: { controlOrigin: composed.uploadPageConfig.controlOrigin,
          s3Origins: composed.uploadPageConfig.s3Origins } } } : {}),
      readerStorage: createStoredReader(pool, parsed.storageScope, contentBase, host.blobs),
      // Reader consent — durable BASKETS consent (Gate B), never the opening.
      readerConsent: createReaderConsentService(pool, parsed.storageScope) };
  } catch (err) {
    logger.error({ err }, "artifact control unavailable; API remains available");
    return { auth, accounts: pool };
  }
}
