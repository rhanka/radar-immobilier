import { Agent as HttpsAgent } from "node:https";
import type pg from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { createS3StagingStore, createS3UploadSigner } from "@sentropic/artifacts/adapters/s3-uploads";
import { createPostgresUploadPageStore, createPostgresUploadSessionStore } from "@sentropic/artifacts/adapters/postgres-uploads";
import type { UploadPageStore } from "@sentropic/artifacts/server/upload-page";
import { createHmacUploadPageCookieSigner, createUploadPageService, type UploadPageService } from "@sentropic/artifacts/server/upload-page";
import { createUploadSweeper } from "@sentropic/artifacts/server/gc";
import { createPostgresCommitExecutor } from "@sentropic/artifacts/adapters/postgres-commit";
import { createArtifactCommitCoordinator } from "@sentropic/artifacts/server/commit-contract";
import { projectArtifactHttpOutcome, type HttpAppDeps } from "@sentropic/artifacts/http";
import type { PublicationBlobStore } from "@sentropic/artifacts/server/publication";
import type { StagingStore, UploadSessionStore, UploadSignerPort } from "@sentropic/artifacts/server/uploads";
import type { ArtifactsStorageConfig } from "./config.js";
import type { ActivationConfig } from "./activation.js";
import { initializeArtifactScope } from "./storage.js";
import { createHostPolicy, authorizeArtifactCommit } from "./commit-policy.js";
import { guardArtifactPool } from "./idempotency.js";
import { createCommitDomain, PUBLISH_BLOB_DEADLINE_MS, resolvePublishDeadlines } from "./commit-domain.js";
import { mapHostError, reportWriteFailure } from "./host-outcome.js";
import { startPreparationCleanup } from "./preparation-cleanup.js";
import { projectArtifactWriteFailure } from "@sentropic/artifacts/server/outcome-contract";
import { createTimeoutBlobStore, createTimeoutS3Client, DEFAULT_S3_BUDGET, withS3Deadline } from "./s3-timeout.js";
import { HOST_ARTIFACT_PROFILE, HOST_MIME_TYPES, isArtifactMutation, RELEASE_FILE_BYTES_MAX, RELEASE_FILES_MAX, RELEASE_TOTAL_BYTES_MAX } from "./p0b-profile.js";
import type { ArtifactDeleteConfirmation } from "./delete-confirmation.js";

/**
 * S3 sockets kept warm for a publish. Every file costs one PUT and one
 * read-back GET in sequence, so a multi-file publish must not pay a fresh
 * TLS handshake per request; 8 lanes also leave room for SDK retries and a
 * concurrent preparation sweep on the same client.
 */
export const PUBLISH_S3_MAX_SOCKETS = 8;

/**
 * Files parity LOT 2 — browser upload page host wiring, required as soon as
 * the page mint capability is selected (always, under P0B).
 */
export interface UploadPageRouteConfig {
  /** Dedicated page-cookie secret (≥32 chars), never the session secret. */
  readonly cookieSecret: string;
  /** Control origin the page is served from (app base URL). */
  readonly controlOrigin: string;
  /** Prefix of the minted page URLs (control origin + `/api/v1`). */
  readonly pageBaseUrl: string;
  /** https storage origins the page may PUT to (empty on plain-http S3). */
  readonly s3Origins: readonly string[];
}

export interface ArtifactHostOptions {
  readonly profile?: HttpAppDeps["profile"];
  readonly coordinator?: HttpAppDeps["coordinator"];
  readonly readActivation?: () => ActivationConfig;
  readonly contentBase?: string;
  readonly onProviderFailure?: (error: unknown) => void;
  readonly confirmation?: ArtifactDeleteConfirmation;
  /**
   * Files parity — injectable upload ports. Production leaves them absent
   * (Postgres ledger + page ledger over the immo 0033/0035 tables, S3
   * staging + presigned signer on the publication bucket); tests inject
   * memory doubles with the same semantics.
   */
  readonly uploads?: { readonly sessions?: UploadSessionStore; readonly staging?: StagingStore;
    readonly signer?: UploadSignerPort; readonly pages?: UploadPageStore };
  /**
   * Files parity LOT 2 — browser upload page host wiring, required as soon
   * as the page mint capability is selected (always, under P0B). Empty
   * s3Origins (plain-http S3) keeps the HTML route closed; the mint,
   * exchange and file endpoints keep working.
   */
  readonly uploadPage?: UploadPageRouteConfig;
}

export async function composeArtifactHost(
  pool: pg.Pool,
  config: Extract<ArtifactsStorageConfig, { enabled: true }>,
  injectedBlobs?: PublicationBlobStore,
  options: ArtifactHostOptions = {},
) {
  pool = guardArtifactPool(pool);
  await initializeArtifactScope(pool, config.storageScope, config.orgId);
  const profile = options.profile ?? HOST_ARTIFACT_PROFILE;
  const policy = await createHostPolicy(pool, config.storageScope, options.readActivation,
    profile.requireExpectedCurrentReleaseId ? "radar-c4-r3-artifacts-cas" : "radar-c4-r2");
  const coordinator = options.coordinator ?? createArtifactCommitCoordinator({
    executor: createPostgresCommitExecutor(pool), policy, mapHostError,
  });
  const budget = config.s3Budget ?? DEFAULT_S3_BUDGET;
  // One warm socket pool for the whole publish sequence: fresh TLS handshakes
  // to the provider stall (5-16 s measured on OVH BHS), so every file's PUT
  // and read-back GET must reuse connections instead of opening one each.
  const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: PUBLISH_S3_MAX_SOCKETS });
  const client = new S3Client({
    endpoint: config.s3Endpoint, region: config.s3Region, forcePathStyle: true,
    credentials: { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey },
    // Each attempt is bounded on its own so a stalled connection is dropped and
    // retried on a new one, inside the operation deadline below. With the
    // attempt timeout equal to the operation deadline, no retry could ever run.
    requestHandler: { requestTimeout: budget.attemptTimeoutMs, connectionTimeout: 3000,
      throwOnRequestTimeout: true, httpsAgent },
    maxAttempts: budget.maxAttempts, retryMode: "standard",
    // Plain PUT/GET without the SDK's default CRC32 headers: the portable form for
    // S3-compatible providers (same settings as deploy/ci/backup/backup-daily.cjs).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const base = injectedBlobs ?? createS3BlobStore({
    client: createTimeoutS3Client(client, budget.operationTimeoutMs), bucket: config.s3Bucket });
  const blobs = createTimeoutBlobStore(base, budget.operationTimeoutMs, options.onProviderFailure);
  const destroyTransport = () => {
    try { httpsAgent.destroy(); } finally { client.destroy(); }
  };
  // The preparation window is derived from the publish blob deadline so the
  // margin for finalization survives any configured value (see
  // resolvePublishDeadlines): blob work always ends before the window.
  const { blobDeadlineMs, preparationWindowMs } =
    resolvePublishDeadlines(config.publishBlobDeadlineMs ?? PUBLISH_BLOB_DEADLINE_MS);
  let uploadSweepTimer: NodeJS.Timeout | undefined;
  try {
    // Files parity — upload staging + presigned PUT signer on the same
    // bucket/client as publication blobs (disjoint `staging/` key prefix),
    // with the enforced sweeper beside the preparation cleanup. The session
    // and page ledgers are the provider Postgres ports over the immo
    // 0033/0035 tables (quota locks, staged TTL, page file bound); the
    // sweeper runs every minute over all five passes — expired sessions,
    // staged TTL with consumed-pin release, orphan staging keys (S3 stores
    // without last-write enumeration skip that pass), and expired pages.
    const uploadSessions = options.uploads?.sessions ?? createPostgresUploadSessionStore(pool);
    const staging = options.uploads?.staging ?? createS3StagingStore({ client, bucket: config.s3Bucket });
    const signer = options.uploads?.signer ?? createS3UploadSigner({ client, bucket: config.s3Bucket });
    const uploadPages = options.uploads?.pages ?? createPostgresUploadPageStore(pool);
    const domain = await createCommitDomain({ pool, scope: config.storageScope, blobs, coordinator,
      profile, preparationWindowMs,
      uploads: { sessions: uploadSessions, staging, signer },
      ...(options.uploadPage ? { uploadPage: { pages: uploadPages, ...options.uploadPage } } : {}),
      ...(options.confirmation ? { confirmation: options.confirmation } : {}),
      ...(options.contentBase ? { publicationUrls: (artifactId, releaseId) => ({
        stableUrl: `https://${artifactId}.${options.contentBase}/`,
        versionUrl: `https://${releaseId}.${options.contentBase}/`,
      }) } : {}),
    });
    // The sweeper shares the publication refs so consumed-pin releases and
    // the orphan/expiry passes see the same ledger as publication.
    const sweeper = createUploadSweeper({ sessions: uploadSessions, staging,
      refs: domain.publicationRefs, pages: uploadPages });
    // Files parity LOT 2 — the browser page service over the same ledger,
    // staging, signer, blobs and claim-guarded refs as the provider's
    // internal page service (same stores, same ceilings, same quota
    // backstop). Caps mirror the provider construction exactly: release
    // budget from the profile ceilings, MIME/path rules from the profile.
    const uploadPageService: UploadPageService | undefined = options.uploadPage ? createUploadPageService({
      pages: uploadPages, sessions: uploadSessions, staging, signer, blobs, refs: domain.publicationRefs,
      idempotency: domain.store,
      cookieSigner: createHmacUploadPageCookieSigner({ secret: options.uploadPage.cookieSecret }),
      // Same caps as the provider's internal page service: release budget
      // from the compiled profile ceilings (publish limits carry the
      // release* overrides), MIME/path rules from the profile rules.
      controlOrigin: options.uploadPage.controlOrigin, pageBaseUrl: options.uploadPage.pageBaseUrl,
      s3Origins: options.uploadPage.s3Origins,
      profile: { maxFiles: RELEASE_FILES_MAX, maxFileBytes: RELEASE_FILE_BYTES_MAX,
        maxTotalBytes: RELEASE_TOTAL_BYTES_MAX, mimeTypes: [...HOST_MIME_TYPES] },
      budget: { filesMax: RELEASE_FILES_MAX, totalBytesMax: RELEASE_TOTAL_BYTES_MAX },
    }) : undefined;
    uploadSweepTimer = setInterval(() => { void sweeper.sweep(undefined, { scopes: [config.storageScope] })
      .catch((error: unknown) => {
        console.error(JSON.stringify({ kind: "artifacts.upload_sweep_unavailable" }));
        options.onProviderFailure?.(error);
      }); }, 60_000);
    uploadSweepTimer.unref();
    const cleanup = startPreparationCleanup(pool, domain.store, blobs, options.onProviderFailure);
    const execute: typeof domain.execute = async (request, invocation) => {
      const dispatch = () => domain.execute(request, invocation);
      // Every PUT and read-back of one publish shares a deadline that ends
      // before the preparation window, so finalization is never refused for it.
      const outcome = request.method === "POST" && ["/publish", "/revert"].includes(request.path)
        ? await withS3Deadline(Date.now() + blobDeadlineMs, dispatch) : await dispatch();
      if (!outcome.ok) {
        const entry = projectArtifactWriteFailure(outcome.failure, {
          dispatched: true, write: request.method === "POST" && isArtifactMutation(request.path.slice(1)),
        });
        if (entry) reportWriteFailure(entry, outcome.failure);
        if (entry) await pool.query(
          `INSERT INTO artifacts.host_failures (invocation_id, actor_id, operation, reason, status, at_ms)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (invocation_id) DO NOTHING`,
          [entry.invocationId, invocation.actorId, entry.operation, entry.reason, entry.status, Date.now()])
          .catch((error: unknown) => {
            accountingFailure = error;
            console.error(JSON.stringify({ kind: "artifacts.accounting_unavailable", invocationId: entry.invocationId }));
            options.onProviderFailure?.(error);
          });
      }
      return outcome;
    };
    let accountingFailure: unknown;
    const handle: typeof domain.app.handle = async (request, invocation) =>
      projectArtifactHttpOutcome(await execute(request, invocation), profile.resultEnvelopeVersion === 2);
    return { ...domain, profile, app: { ...domain.app, execute, handle }, execute, coordinator, blobs,
      get accountingFailure() { return accountingFailure; },
      cleanup, intents: domain.store, refs: domain.store,
      selectedCapabilities: domain.app.selectedCapabilities, profileDigest: domain.app.profileDigest,
      authorizeCommit: authorizeArtifactCommit,
      ...(uploadPageService ? { uploadPageService, uploadPageConfig: {
        controlOrigin: options.uploadPage!.controlOrigin, s3Origins: options.uploadPage!.s3Origins } } : {}),
      close: () => { clearInterval(uploadSweepTimer); cleanup.stop(); destroyTransport(); } };
  } catch (error) { clearInterval(uploadSweepTimer); destroyTransport(); throw error; }
}
