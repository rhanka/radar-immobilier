import type pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createPostgresArtifactStore } from "@sentropic/artifacts/adapters/postgres";
import { createLifecycleService } from "@sentropic/artifacts/server/lifecycle";
import { createPublicationService, type PublicationBlobStore } from "@sentropic/artifacts/server/publication";
import type { ArtifactsStorageConfig } from "@radar/artifacts-host";
import { initializeArtifactScope } from "../../../packages/artifacts-host/src/storage.js";
import { createPurgeTestHost } from "./artifacts-purge-race.helpers.js";
import { requirePublicFunction, COMMIT_CONTRACT_SPECIFIER, finalizationPhaseFaults,
  type R2CommitCoordinator, type CompiledArtifactsProfile,
  type InvocationContextShape, type CoordinatorBarrierPoint } from "./artifacts-provider-contract.helpers.js";

/** Host SQL is confined to the registered participant's leased connection. */
export interface PolicyClient {
  query<T>(text: string, params: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

const currentInvocation = new AsyncLocalStorage<InvocationContextShape>();

export async function readTestPolicyRevision(client: PolicyClient, locked = true): Promise<string> {
  if (locked) {
    const actorId = currentInvocation.getStore()?.actorId;
    if (!actorId) throw new Error("policy lock requires the current invocation actor");
    await client.query("SELECT sub FROM account_users WHERE sub = $1 FOR SHARE", [actorId]);
  }
  const table = await client.query<{ present: string | null }>(
    "SELECT to_regclass('test_policy_revision') AS present", []);
  if (!table.rows[0]?.present) return "radar-test-policy/v1";
  const revision = await client.query<{ rev: string }>(
    `SELECT rev FROM test_policy_revision WHERE id = 1${locked ? " FOR SHARE" : ""}`, []);
  if (!revision.rows[0]) throw new Error("test policy revision is absent");
  return revision.rows[0].rev;
}

export async function createCandidateCoordinator(pool: pg.Pool, testObserver: unknown,
  testPoints?: readonly CoordinatorBarrierPoint[]): Promise<R2CommitCoordinator> {
  const create = await requirePublicFunction<(options: unknown) => R2CommitCoordinator>(
    COMMIT_CONTRACT_SPECIFIER, "createArtifactCommitCoordinator");
  const executor = await requirePublicFunction<(pool: pg.Pool) => unknown>(
    "@sentropic/artifacts/adapters/postgres-commit", "createPostgresCommitExecutor");
  return create({ executor: executor(pool), testObserver,
    ...(testPoints === undefined ? {} : { testPoints }),
    policy: { createParticipant(client: PolicyClient, transactionToken: string) {
      return {
        readRevision: () => readTestPolicyRevision(client),
        async checkApproval(input: { actorId: string }) {
          const guardTable = await client.query<{ present: string | null }>(
            "SELECT to_regclass('test_guard_authority') AS present", []);
          if (guardTable.rows[0]?.present) {
            await client.query("SELECT id FROM test_guard_authority WHERE id = 1 FOR SHARE", []);
          }
          const result = await client.query<{ status: string }>(
            "SELECT status FROM account_users WHERE sub = $1 FOR SHARE", [input.actorId]);
          return { approved: result.rows[0]?.status === "approved", reason: "denied" };
        },
        // Quota accounting stays explicitly uncovered in H3 units 5-6.
        async reserveQuota() {
          finalizationPhaseFaults.get(pool)?.("quota");
          return { reserved: true };
        },
        mintFence(policyRevision: string, invocationId: string) {
          return { fenceId: `test-fence-${transactionToken}`, transactionId: transactionToken,
            invocationId, policyRevision };
        },
      };
    } },
  });
}

/** Test composition only: production remains pinned to its published provider. */
export async function composeCandidateHost(params: {
  pool: pg.Pool; config: unknown; blobs: unknown;
  profile: CompiledArtifactsProfile; coordinator: R2CommitCoordinator;
}): Promise<Record<string, unknown>> {
  const config = params.config as Extract<ArtifactsStorageConfig, { enabled: true }>;
  const blobs = params.blobs as PublicationBlobStore;
  const { pool, profile, coordinator } = params;
  const createApp = await requirePublicFunction<(deps: unknown) => {
    selectedCapabilities: readonly string[]; profileDigest: string;
    execute(request: unknown, invocation: InvocationContextShape): Promise<unknown>;
  }>("@sentropic/artifacts/http", "createHttpArtifactApp");
  const derive = await requirePublicFunction<(config: unknown) => unknown>(
    "@sentropic/artifacts/mcp-core", "createRadarKeyDerivation");
  const legacy = await requirePublicFunction<(pool: pg.Pool) => unknown>(
    "@sentropic/artifacts/adapters/postgres", "createPostgresLegacyArtifactRecords");
  const unitWriter = await requirePublicFunction<(client: PolicyClient) => unknown>(
    "@sentropic/artifacts/server/publication", "createPostgresPublicationUnitWriter");
  const refs = await requirePublicFunction<(store: unknown, executor: unknown) => unknown>(
    "@sentropic/artifacts/server/gc", "createPostgresClaimGuardedRefs");
  const executor = await requirePublicFunction<(pool: pg.Pool) => unknown>(
    "@sentropic/artifacts/adapters/postgres-commit", "createPostgresCommitExecutor");
  const migration = createRequire(import.meta.url).resolve(
    "@sentropic/artifacts/migrations/0003_coordinator.sql");
  await pool.query(await readFile(migration, "utf8"));
  await initializeArtifactScope(pool, config.storageScope, config.orgId);
  const store = createPostgresArtifactStore(pool);
  const { claims } = await createPurgeTestHost(pool, config.storageScope, blobs);
  const actors = await pool.query<{ sub: string }>("SELECT sub FROM account_users");
  const publication = createPublicationService({ state: store, blobs, intents: store });
  const artifact = new AsyncLocalStorage<string>();
  const lock = (table: string, column: string) => async (client: PolicyClient) => {
    await client.query(`SELECT ${column} FROM artifacts.${table} WHERE ${column} = $1 FOR UPDATE`,
      [artifact.getStore()]);
  };
  const app = createApp({ profile, coordinator,
    derivation: derive({ storageScopeId: config.storageScope, actorIds: actors.rows.map((row) => row.sub) }),
    legacyRecords: legacy(pool),
    ensureHost: {
      readPolicyRevision: () => readTestPolicyRevision(pool as unknown as PolicyClient, false),
      async lockBinding(client: PolicyClient, binding: { storageScopeId: string; ownerId: string; bindingName: string }) {
        finalizationPhaseFaults.get(pool)?.("binding");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [JSON.stringify([binding.storageScopeId, binding.ownerId, binding.bindingName])]);
      },
      resolveBinding(client: PolicyClient, binding: { storageScopeId: string; ownerId: string; bindingName: string }) {
        return createPostgresArtifactStore(client as unknown as pg.Pool).ensureArtifact({ ...binding, profile: {} });
      },
      async abandonAttempt() { /* Ensure creates no external preparation objects. */ },
    },
    acls: store, lifecycle: createLifecycleService(store, undefined, store),
    publication: { blobs, intents: store, refs: refs(store, executor(pool)),
      createUnitWriter: unitWriter, getCurrent: publication.getCurrent,
      locks: { "artifact-lifecycle": [lock("artifacts", "id")],
        acl: [lock("artifact_access", "artifact_id")],
        "current-pointer": [lock("artifact_current", "artifact_id")] } },
    publicationUrls: (artifactId: string, releaseId: string) => ({
      stableUrl: `https://${artifactId}.pages.example.test/`,
      pinnedUrl: `https://${releaseId}.pinned.pages.example.test/`,
    }),
  });
  return { app, store, publication, profile, coordinator, blobs, claims, intents: store, refs: store,
    selectedCapabilities: app.selectedCapabilities, profileDigest: app.profileDigest,
    execute(request: Record<string, unknown>, invocation: InvocationContextShape) {
      const body = request["body"] as { artifactId?: string } | undefined;
      return currentInvocation.run(invocation, () => artifact.run(body?.artifactId ?? "",
        () => app.execute({ ...request, actorId: request["actorId"] ?? invocation.actorId }, invocation)));
    },
    close() { /* The suite owns the injected pool and blob-store lifecycle. */ },
  };
}
