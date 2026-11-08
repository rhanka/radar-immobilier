import {
  composeArtifactHost, createAccountDirectory, createArtifactControl, createArtifactsPool,
  resolveArtifactsStorageConfig, type ArtifactsConfigInput, type ArtifactsPoolParams,
  createArtifactAdmissionAuthority, readActivationEnv, resolveActivationConfig,
  ARTIFACT_P0B, createDeleteConfirmation, readUploadPageWiring,
  ARTIFACT_GIT_MODE, createLiveHostEndpoints, loadLiveHost, readLiveHostKeys, composeHostBuildLedger, composeLiveEdgePorts,
  readLiveEdgeEnabled, createLiveSocketRegistry, type LiveEdgePorts,
} from "@radar/artifacts-host";
import type { LiveSessionService } from "@sentropic/artifacts";
import type { AuthConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { ControlRouteDeps } from "./control-route.js";
import type { UploadPageService } from "@sentropic/artifacts/server/upload-page";
import { createPostgresUploadPageStore } from "@sentropic/artifacts/adapters/postgres-uploads";
import { BASKET_READ_SCOPE_ID, createReaderConsentService } from "./reader-consent.js";
import { createStoredReader } from "./reader-storage.js";

/**
 * Files parity LOT 2 — browser upload page wiring, shared with the immo-mcp
 * binding (`readUploadPageWiring` in artifacts-host). The page cookie secret
 * is a dedicated secret (never the session secret). Absent or short under
 * P0B, the control plane stays closed with an explicit log — the provider
 * requires this wiring as soon as the page mint capability is selected.
 */

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
    // Dependency diagnostics first (DB reachability, schema/journal, scope):
    // the upload-page wiring is read here so it can be passed to the host,
    // but a missing secret is only reported AFTER composeArtifactHost has
    // validated the dependencies, so the control log keeps the real cause.
    const uploadPage = ARTIFACT_P0B ? readUploadPageWiring({ secret: process.env["ARTIFACTS_UPLOAD_PAGE_SECRET"],
      controlOrigin: auth.appBaseUrl, s3Endpoint: parsed.s3Endpoint }) : null;
    // The proxied live sockets of this process are shared by the content host forward and the package live
    // service (its invitations onRevoked closes them first); the composed service gives the forward the same
    // liveViewer / liveInvitationState views.
    const liveSockets = createLiveSocketRegistry();
    const liveParts: { liveService?: LiveSessionService } = {};
    const host = await composeArtifactHost(pool, parsed, undefined, { readActivation, contentBase,
      gitMode: { ports: { liveSockets, onLiveService: (service) => { liveParts.liveService = service; } } },
      ...(confirmation ? { confirmation } : {}),
      ...(uploadPage ? { uploadPage } : {}) });
    if (ARTIFACT_P0B && !uploadPage) {
      try { host.close(); } catch { /* host already torn down by compose */ }
      throw new Error("artifact upload page secret missing (ARTIFACTS_UPLOAD_PAGE_SECRET)");
    }
    const backend = createArtifactControl(host, parsed.storageScope, contentBase,
      createArtifactAdmissionAuthority(pool, readActivation, parsed.storageScope),
      { directory: createAccountDirectory(pool) });
    logger.info({ storageScope: parsed.storageScope, s3Bucket: parsed.s3Bucket }, "artifact control enabled");
    // Git mode stage `build` and later: the inbound SG4b host build API for
    // the Sentropic builder. Flag off (default): not composed, not mounted.
    const liveHostModule = ARTIFACT_GIT_MODE.tools.includes("artifacts_git_publish") ? await loadLiveHost() : undefined;
    const liveHost = ARTIFACT_GIT_MODE.tools.includes("artifacts_git_publish")
      ? createLiveHostEndpoints({ module: liveHostModule, scopeId: parsed.storageScope,
        keys: readLiveHostKeys(process.env),
        ledger: composeHostBuildLedger({ pool, storageScopeId: parsed.storageScope, blobs: host.blobs,
          module: liveHostModule, env: process.env }) })
      : undefined;
    const readerConsent = createReaderConsentService(pool, parsed.storageScope);
    // Live edge forward (A-LIVE §8.2, W9 CORRECTIF): stage `live` AND
    // IMMO_ARTIFACTS_LIVE_EDGE_ENABLED=1. Off by default: nothing is composed.
    // On with an incomplete configuration: the unavailable state (release kept).
    // Baskets reader consent: a non-revoked reader consent row (baskets.read,
    // current scope version), re-read on every admission. Owner-only unless the
    // generic invitations of @sentropic/artifacts 0.2.22 are qualified.
    let liveEdge: LiveEdgePorts | undefined;
    if (readLiveEdgeEnabled(process.env, ARTIFACT_GIT_MODE.stage)) {
      try {
        liveEdge = composeLiveEdgePorts({ pool, storageScopeId: parsed.storageScope, env: process.env,
          stage: ARTIFACT_GIT_MODE.stage, contentBase, module: liveHostModule ?? await loadLiveHost(), sockets: liveSockets,
          ...(liveParts.liveService ? { views: liveParts.liveService } : {}),
          consent: (principalId, artifactId) => readerConsent.hasLiveConsent(principalId, artifactId, BASKET_READ_SCOPE_ID) });
      } catch (err) {
        logger.error({ err }, "live edge unavailable; release serving unchanged");
      }
    }
    if (liveEdge) {
      logger.info({ liveEdge: "reason" in liveEdge.resolution ? liveEdge.resolution.reason : "configured" }, "live edge forward composed");
    }
    const composed = host as typeof host & { uploadPageService?: UploadPageService;
      uploadPageConfig?: { controlOrigin: string; s3Origins: readonly string[] } };
    return { auth, accounts: pool, backend, readActivation, storageScope: parsed.storageScope,
      ...(confirmation ? { confirmation } : {}),
      ...(liveHost ? { liveHost } : {}),
      ...(liveEdge ? { liveEdge } : {}),
      // Browser upload page (LOT 2): same ledger as the provider, mounted on
      // the control origin with the control session rules. The page store
      // backs the session↔owner binding enforced by the route before every
      // exchange and file call.
      ...(composed.uploadPageService && composed.uploadPageConfig ? { uploadPage: {
        service: composed.uploadPageService,
        config: { controlOrigin: composed.uploadPageConfig.controlOrigin,
          s3Origins: composed.uploadPageConfig.s3Origins },
        pages: createPostgresUploadPageStore(pool) } } : {}),
      readerStorage: createStoredReader(pool, parsed.storageScope, contentBase, host.blobs),
      // Reader consent — durable BASKETS consent (Gate B), never the opening.
      readerConsent };
  } catch (err) {
    logger.error({ err }, "artifact control unavailable; API remains available");
    return { auth, accounts: pool };
  }
}
