import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import { createPostgresArtifactStore, createPostgresLegacyArtifactRecords } from "@sentropic/artifacts/adapters/postgres";
import { createPostgresCommitExecutor } from "@sentropic/artifacts/adapters/postgres-commit";
import { createHttpArtifactApp, type HttpAppDeps } from "@sentropic/artifacts/http";
import { createRadarKeyDerivation } from "@sentropic/artifacts/mcp-core";
import { createLifecycleService } from "@sentropic/artifacts/server/lifecycle";
import { createPostgresClaimGuardedRefs } from "@sentropic/artifacts/server/gc";
import { createPostgresPublicationUnitWriter, createPublicationService } from "@sentropic/artifacts/server/publication";
import type { ArtifactInvocationContext, FinalizeTxClient } from "@sentropic/artifacts/server/commit-contract";

export async function createCommitDomain(options: Pick<HttpAppDeps, "profile" | "coordinator"> & {
  pool: pg.Pool; scope: string; blobs: HttpAppDeps["publication"]["blobs"];
  publicationUrls?: HttpAppDeps["publicationUrls"];
}) {
  const { pool, scope, blobs, profile, coordinator } = options;
  const store = createPostgresArtifactStore(pool);
  const publication = createPublicationService({ state: store, blobs, intents: store });
  const actors = await pool.query<{ sub: string }>("SELECT sub FROM account_users ORDER BY sub");
  const artifact = new AsyncLocalStorage<string>();
  const lock = (table: string, column: string) => async (client: FinalizeTxClient) => {
    await client.query(`SELECT ${column} FROM artifacts.${table} WHERE ${column} = $1 FOR UPDATE`,
      [artifact.getStore()]);
  };
  const app = createHttpArtifactApp({ profile, coordinator,
    derivation: createRadarKeyDerivation({ storageScopeId: scope, actorIds: actors.rows.map((row) => row.sub) }),
    legacyRecords: createPostgresLegacyArtifactRecords(pool),
    ensureHost: {
      async readPolicyRevision() {
        const result = await pool.query<{ revision: string }>(
          "SELECT revision FROM artifacts.host_policy WHERE storage_scope_id = $1", [scope]);
        if (!result.rows[0]) throw new Error("artifact policy unavailable");
        return result.rows[0].revision;
      },
      async lockBinding(client, binding) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [JSON.stringify([binding.storageScopeId, binding.ownerId, binding.bindingName])]);
      },
      resolveBinding(client, binding) {
        return createPostgresArtifactStore(client as unknown as pg.Pool).ensureArtifact({ ...binding, profile: {} });
      },
      async abandonAttempt() { /* Ensure stages no external objects. */ },
    },
    acls: store, lifecycle: createLifecycleService(store, undefined, store),
    publication: { blobs, intents: store, refs: createPostgresClaimGuardedRefs(store, createPostgresCommitExecutor(pool)),
      cleanupWindowMs: 30_000, createUnitWriter: createPostgresPublicationUnitWriter, getCurrent: publication.getCurrent,
      locks: { "artifact-lifecycle": [lock("artifacts", "id")], acl: [lock("artifact_access", "artifact_id")],
        "current-pointer": [lock("artifact_current", "artifact_id")] } },
    ...(options.publicationUrls ? { publicationUrls: options.publicationUrls } : {}),
  });
  const execute: typeof app.execute = (request, invocation: ArtifactInvocationContext) => {
    const body = request.body as { artifactId?: string } | undefined;
    return artifact.run(body?.artifactId ?? "", () => app.execute(request, invocation));
  };
  return { app: { ...app, execute }, execute, store, publication };
}
