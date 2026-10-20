import type pg from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { createS3BlobStore } from "@sentropic/artifacts/adapters/s3";
import { createHttpArtifactApp } from "@sentropic/artifacts/http";
import { createLifecycleService } from "@sentropic/artifacts/server/lifecycle";
import { createPublicationService, type PublicationBlobStore } from "@sentropic/artifacts/server/publication";
import type { ForkService } from "@sentropic/artifacts/server/fork";
import type { ArtifactService } from "@sentropic/artifacts/server/service";
import type { ArtifactsStorageConfig } from "./config.js";
import { createLockedArtifactStore, initializeArtifactScope } from "./storage.js";
import { createTimeoutBlobStore, createTimeoutS3Client, S3_OPERATION_TIMEOUT_MS } from "./s3-timeout.js";

const refuse = async (): Promise<never> => { throw new Error("capability unavailable"); };
export const unavailableForks: ForkService = { fork: refuse, setState: refuse, track: refuse };

export async function composeArtifactHost(
  pool: pg.Pool,
  config: Extract<ArtifactsStorageConfig, { enabled: true }>,
  injectedBlobs?: PublicationBlobStore,
) {
  await initializeArtifactScope(pool, config.storageScope, config.orgId);
  const store = createLockedArtifactStore(pool);
  const getAcl = store.getArtifactAcl;
  store.getArtifactAcl = async (id) => {
    const acl = await getAcl(id);
    return acl?.storageScopeId === config.storageScope ? acl : undefined;
  };
  const client = new S3Client({
    endpoint: config.s3Endpoint, region: config.s3Region, forcePathStyle: true,
    credentials: { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey },
    requestHandler: { requestTimeout: 5000, connectionTimeout: 3000, throwOnRequestTimeout: true },
  });
  const timeoutClient = createTimeoutS3Client(client, S3_OPERATION_TIMEOUT_MS);
  const baseBlobs = injectedBlobs ?? createS3BlobStore({ client: timeoutClient, bucket: config.s3Bucket });
  // Bound every blob operation including body streaming after headers, so a
  // stalled S3 response fails fast and frees the advisory lock + connection.
  const blobs = createTimeoutBlobStore(baseBlobs, S3_OPERATION_TIMEOUT_MS);
  const lifecycle = createLifecycleService(store, undefined, store);
  const publication = createPublicationService({ state: store, blobs, intents: store, idempotency: store });
  const artifacts: ArtifactService = {
    async ensurePrivateView(input) {
      if (input.actorUserId !== input.ownerId || input.storageScopeId !== config.storageScope) {
        throw new Error("access denied");
      }
      const { result, replayed } = await store.execute(input.idempotencyKey, input.paramsHash,
        () => store.ensureArtifact({
          storageScopeId: config.storageScope, ownerId: input.ownerId,
          bindingName: input.bindingName, profile: {},
        }));
      return { ...result, replayed };
    },
  };
  const app = createHttpArtifactApp({
    parameterSchema: { declarations: [] }, artifacts, publication, lifecycle, forks: unavailableForks,
    acls: store, sources: store, blobs,
  });
  return { app, store, publication, close: () => client.destroy() };
}
