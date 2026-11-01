import type pg from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { createPostgresCommitExecutor } from "@sentropic/artifacts/adapters/postgres-commit";
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from "@sentropic/artifacts/mcp-core";
import { createArtifactCommitCoordinator } from "@sentropic/artifacts/server/commit-contract";
import { projectArtifactHttpOutcome, type HttpAppDeps } from "@sentropic/artifacts/http";
import type { PublicationBlobStore } from "@sentropic/artifacts/server/publication";
import type { ArtifactsStorageConfig } from "./config.js";
import type { ActivationConfig } from "./activation.js";
import { initializeArtifactScope } from "./storage.js";
import { createHostPolicy, authorizeArtifactCommit } from "./commit-policy.js";
import { guardArtifactPool } from "./idempotency.js";
import { createCommitDomain, PUBLISH_BLOB_DEADLINE_MS } from "./commit-domain.js";
import { mapHostError, reportWriteFailure } from "./host-outcome.js";
import { startPreparationCleanup } from "./preparation-cleanup.js";
import { projectArtifactWriteFailure } from "@sentropic/artifacts/server/outcome-contract";
import { createTimeoutBlobStore, createTimeoutS3Client, DEFAULT_S3_BUDGET, withS3Deadline } from "./s3-timeout.js";

export interface ArtifactHostOptions {
  readonly profile?: HttpAppDeps["profile"];
  readonly coordinator?: HttpAppDeps["coordinator"];
  readonly readActivation?: () => ActivationConfig;
  readonly contentBase?: string;
  readonly onProviderFailure?: (error: unknown) => void;
}

export async function composeArtifactHost(
  pool: pg.Pool,
  config: Extract<ArtifactsStorageConfig, { enabled: true }>,
  injectedBlobs?: PublicationBlobStore,
  options: ArtifactHostOptions = {},
) {
  pool = guardArtifactPool(pool);
  await initializeArtifactScope(pool, config.storageScope, config.orgId);
  const policy = await createHostPolicy(pool, config.storageScope, options.readActivation);
  const coordinator = options.coordinator ?? createArtifactCommitCoordinator({
    executor: createPostgresCommitExecutor(pool), policy, mapHostError,
  });
  const budget = config.s3Budget ?? DEFAULT_S3_BUDGET;
  const client = new S3Client({
    endpoint: config.s3Endpoint, region: config.s3Region, forcePathStyle: true,
    credentials: { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey },
    // Each attempt is bounded on its own so a stalled connection is dropped and
    // retried on a new one, inside the operation deadline below. With the
    // attempt timeout equal to the operation deadline, no retry could ever run.
    requestHandler: { requestTimeout: budget.attemptTimeoutMs, connectionTimeout: 3000, throwOnRequestTimeout: true },
    maxAttempts: budget.maxAttempts, retryMode: "standard",
    // Plain PUT/GET without the SDK's default CRC32 headers: the portable form for
    // S3-compatible providers (same settings as deploy/ci/backup/backup-daily.cjs).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const base = injectedBlobs ?? createS3BlobStore({
    client: createTimeoutS3Client(client, budget.operationTimeoutMs), bucket: config.s3Bucket });
  const blobs = createTimeoutBlobStore(base, budget.operationTimeoutMs, options.onProviderFailure);
  try {
    const domain = await createCommitDomain({ pool, scope: config.storageScope, blobs, coordinator,
      profile: options.profile ?? compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE),
      ...(options.contentBase ? { publicationUrls: (artifactId, releaseId) => ({
        stableUrl: `https://${artifactId}.${options.contentBase}/`,
        pinnedUrl: `https://${releaseId}.pinned.${options.contentBase}/`,
      }) } : {}),
    });
    const cleanup = startPreparationCleanup(pool, domain.store, blobs, options.onProviderFailure);
    const execute: typeof domain.execute = async (request, invocation) => {
      const dispatch = () => domain.execute(request, invocation);
      // Every PUT and read-back of one publish shares a deadline that ends
      // before the preparation window, so finalization is never refused for it.
      const outcome = request.method === "POST" && request.path === "/publish"
        ? await withS3Deadline(Date.now() + PUBLISH_BLOB_DEADLINE_MS, dispatch) : await dispatch();
      if (!outcome.ok) {
        const entry = projectArtifactWriteFailure(outcome.failure, {
          dispatched: true, write: request.method === "POST" && ["/ensure", "/publish"].includes(request.path),
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
      projectArtifactHttpOutcome(await execute(request, invocation));
    return { ...domain, app: { ...domain.app, execute, handle }, execute, coordinator, blobs,
      get accountingFailure() { return accountingFailure; },
      cleanup, intents: domain.store, refs: domain.store,
      selectedCapabilities: domain.app.selectedCapabilities, profileDigest: domain.app.profileDigest,
      authorizeCommit: authorizeArtifactCommit, close: () => { cleanup.stop(); client.destroy(); } };
  } catch (error) { client.destroy(); throw error; }
}
