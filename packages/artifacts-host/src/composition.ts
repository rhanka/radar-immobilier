import type pg from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { createPostgresCommitExecutor } from "@sentropic/artifacts/adapters/postgres-commit";
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from "@sentropic/artifacts/mcp-core";
import { createArtifactCommitCoordinator } from "@sentropic/artifacts/server/commit-contract";
import type { HttpAppDeps } from "@sentropic/artifacts/http";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import type { PublicationBlobStore } from "@sentropic/artifacts/server/publication";
import type { ArtifactsStorageConfig } from "./config.js";
import type { ActivationConfig } from "./activation.js";
import { initializeArtifactScope } from "./storage.js";
import { createHostPolicy, authorizeArtifactCommit } from "./commit-policy.js";
import { createCommitDomain } from "./commit-domain.js";
import { createTimeoutBlobStore, createTimeoutS3Client, S3_OPERATION_TIMEOUT_MS } from "./s3-timeout.js";

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
  await initializeArtifactScope(pool, config.storageScope, config.orgId);
  const policy = await createHostPolicy(pool, config.storageScope, options.readActivation);
  const coordinator = options.coordinator ?? createArtifactCommitCoordinator({
    executor: createPostgresCommitExecutor(pool), policy,
  });
  const client = new S3Client({
    endpoint: config.s3Endpoint, region: config.s3Region, forcePathStyle: true,
    credentials: { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey },
    requestHandler: { requestTimeout: 5000, connectionTimeout: 3000, throwOnRequestTimeout: true },
  });
  const base = injectedBlobs ?? createS3BlobStore({ client: createTimeoutS3Client(client), bucket: config.s3Bucket });
  const bounded = createTimeoutBlobStore(base, S3_OPERATION_TIMEOUT_MS, options.onProviderFailure);
  const blobs: PublicationBlobStore = Object.fromEntries(
    ["putBlob", "getBlob", "listKeys", "deleteBlob"].map((method) => [method, async (...args: unknown[]) => {
      try { return await (bounded[method as keyof PublicationBlobStore] as (...a: unknown[]) => unknown)(...args); }
      catch (cause) {
        if ((cause as { code?: string } | null)?.code === "artifact_s3_timeout") {
          throw new ArtifactOperationError("provider_unavailable", { cause });
        }
        throw cause;
      }
    }]),
  ) as unknown as PublicationBlobStore;
  try {
    const domain = await createCommitDomain({ pool, scope: config.storageScope, blobs, coordinator,
      profile: options.profile ?? compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE),
      ...(options.contentBase ? { publicationUrls: (artifactId, releaseId) => ({
        stableUrl: `https://${artifactId}.${options.contentBase}/`,
        pinnedUrl: `https://${releaseId}.pinned.${options.contentBase}/`,
      }) } : {}),
    });
    return { ...domain, coordinator, blobs, intents: domain.store, refs: domain.store,
      selectedCapabilities: domain.app.selectedCapabilities, profileDigest: domain.app.profileDigest,
      authorizeCommit: authorizeArtifactCommit, close: () => client.destroy() };
  } catch (error) { client.destroy(); throw error; }
}
