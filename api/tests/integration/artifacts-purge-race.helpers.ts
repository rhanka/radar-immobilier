import type pg from "pg";
import { createPostgresArtifactStore } from "@sentropic/artifacts/adapters/postgres";
import { requirePublicFunction, type PurgeDeletionClaims, type PurgeTestHost } from "./artifacts-provider-contract.helpers.js";
import type { PolicyClient } from "./artifacts-provider-r2.helpers.js";

interface PurgeClient extends PolicyClient {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(error?: unknown): void;
}
interface PurgeExecutor { beginFinalization(): Promise<PurgeClient> }

/** Bind A4 to real durable claims and GC; the deletion override is per purge. */
export async function createPurgeTestHost(pool: pg.Pool, storageScopeId: string,
  blobs: PurgeTestHost["blobs"]): Promise<PurgeTestHost> {
  const createExecutor = await requirePublicFunction<(pool: pg.Pool) => PurgeExecutor>(
    "@sentropic/artifacts/adapters/postgres", "createPostgresCommitExecutor");
  const createClaims = await requirePublicFunction<(client: PolicyClient) => PurgeDeletionClaims>(
    "@sentropic/artifacts/server/gc", "createPostgresDeletionClaimStore");
  const createGc = await requirePublicFunction<(executor: PurgeExecutor,
    refs: (client: PolicyClient) => ReturnType<typeof createPostgresArtifactStore>) => {
      collect(blobs: PurgeTestHost["blobs"], prefix: string): Promise<{ failures: unknown[] }>;
    }>("@sentropic/artifacts/server/gc", "createPostgresGcService");
  const executor = createExecutor(pool);
  const storeFor = (client: PolicyClient) => createPostgresArtifactStore(client as unknown as pg.Pool);
  return { storageScopeId, blobs, claims: createClaims(pool as unknown as PolicyClient),
    async purge(artifactId, deleting) {
      const client = await executor.beginFinalization();
      try {
        const store = storeFor(client);
        await client.query("SELECT id FROM artifacts.artifacts WHERE id=$1 AND storage_scope_id=$2 FOR UPDATE",
          [artifactId, storageScopeId]);
        const refs = await client.query<{ digest: string; holder: string }>(
          `SELECT digest, holder FROM artifacts.blob_ref_holders
           WHERE holder IN (SELECT id::text FROM artifacts.releases WHERE artifact_id=$1)`, [artifactId]);
        for (const ref of refs.rows) await store.releaseRef(ref.digest, ref.holder);
        const claims = createClaims(client);
        for (const digest of new Set(refs.rows.map((ref) => ref.digest))) {
          await claims.withDigestLock(digest, async (locked) => {
            if (await store.count(digest) === 0 && !await store.isPinned(digest)) {
              await locked.claim(digest, `purge:${artifactId}`);
            }
          });
        }
        for (const id of await store.listArtifactReleases(artifactId)) await store.setReleaseState(id, "purged");
        await store.setArtifactState(artifactId, "purged");
        await client.commit();
      } catch (error) { await client.rollback(); throw error; }
      finally { client.release(); }
      const report = await createGc(executor, storeFor).collect(deleting, `artifacts/${storageScopeId}/`);
      if (report.failures.length) throw new Error("A4 purge failed during external deletion");
    },
  };
}
