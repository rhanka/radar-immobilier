import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import { createPostgresArtifactStore, createPostgresLegacyArtifactRecords } from "@sentropic/artifacts/adapters/postgres";
import { createPostgresCommitExecutor } from "@sentropic/artifacts/adapters/postgres-commit";
import { createHttpArtifactApp, projectArtifactHttpOutcome, type HttpAppDeps } from "@sentropic/artifacts/http";
import { ArtifactProfileInputError, createRadarKeyDerivation } from "@sentropic/artifacts/mcp-core";
import { createLifecycleService } from "@sentropic/artifacts/server/lifecycle";
import { createPostgresClaimGuardedRefs } from "@sentropic/artifacts/server/gc";
import { createPostgresPublicationUnitWriter, createPublicationService } from "@sentropic/artifacts/server/publication";
import { CommitQuarantineError, type ArtifactInvocationContext, type FinalizeTxClient } from "@sentropic/artifacts/server/commit-contract";
import { ArtifactOperationError, classifyArtifactFailure } from "@sentropic/artifacts/server/outcome-contract";
import { assertArtifactReplayMigration } from "@sentropic/artifacts/server/idempotency";
import { mapHostError, normalizeHostOutcome } from "./host-outcome.js";
import { rateLimitedOutcome, reserveArtifactAttempt } from "./attempt-admission.js";
import { replayPublication } from "./publication-replay.js";

/**
 * A prepared publication must finalize within this window: past it, the
 * preparation sweeper reclaims the staged blobs and finalization is refused
 * ("preparation expired or abandoned").
 */
export const PREPARATION_WINDOW_MS = 30_000;

/** Kept after the last blob operation of a publish for its finalization transaction. */
export const PUBLISH_FINALIZE_MARGIN_MS = 10_000;

/**
 * Shared deadline of every blob operation of one publish, counted from dispatch
 * (before the preparation starts), so a slow provider ends the publish with a
 * retriable 503 instead of an expired preparation.
 */
export const PUBLISH_BLOB_DEADLINE_MS = PREPARATION_WINDOW_MS - PUBLISH_FINALIZE_MARGIN_MS;

export async function createCommitDomain(options: Pick<HttpAppDeps, "profile" | "coordinator"> & {
  pool: pg.Pool; scope: string; blobs: HttpAppDeps["publication"]["blobs"];
  publicationUrls?: HttpAppDeps["publicationUrls"];
}) {
  const { pool, scope, blobs, profile, coordinator } = options;
  const store = createPostgresArtifactStore(pool);
  const publication = createPublicationService({ state: store, blobs, intents: store });
  const keyDomain = new AsyncLocalStorage<ReturnType<typeof createRadarKeyDerivation>>();
  const artifact = new AsyncLocalStorage<string>();
  const legacyRecords = createPostgresLegacyArtifactRecords(pool);
  const lock = (table: string, column: string) => async (client: FinalizeTxClient) => {
    await client.query(`SELECT ${column} FROM artifacts.${table} WHERE ${column} = $1 FOR UPDATE`,
      [artifact.getStore()]);
  };
  const app = createHttpArtifactApp({ profile, coordinator, mapHostError,
    derivation: { algorithm: "radar-derive-idempotency-v1", derive(input) {
      const binding = keyDomain.getStore();
      if (!binding) throw new Error("artifact key domain unavailable");
      return binding.derive(input);
    } },
    legacyRecords,
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
      cleanupWindowMs: PREPARATION_WINDOW_MS, createUnitWriter: createPostgresPublicationUnitWriter, getCurrent: publication.getCurrent,
      locks: { "artifact-lifecycle": [lock("artifacts", "id")], acl: [lock("artifact_access", "artifact_id")],
        "current-pointer": [lock("artifact_current", "artifact_id")] } },
    ...(options.publicationUrls ? { publicationUrls: options.publicationUrls } : {}),
  });
  const execute: typeof app.execute = async (request, invocation: ArtifactInvocationContext) => {
    try {
      const actors = await pool.query<{ sub: string }>("SELECT sub FROM account_users ORDER BY sub");
      const binding = createRadarKeyDerivation({ storageScopeId: scope, actorIds: actors.rows.map((row) => row.sub) });
      const body = request.body as { artifactId?: string } | undefined;
      return normalizeHostOutcome(await keyDomain.run(binding,
        () => artifact.run(body?.artifactId ?? "", async () => {
          const write = request.method === "POST" && ["/ensure", "/publish"].includes(request.path);
          if (write && invocation.actorId && invocation.storageScopeId === scope &&
            request.actorId === invocation.actorId &&
            (request.storageScopeId === undefined || request.storageScopeId === scope)) {
            const args = { ...request.body as Record<string, unknown> };
            if (args.storageScopeId !== undefined && args.storageScopeId !== scope) return app.execute(request, invocation);
            delete args.storageScopeId;
            const capability = `artifacts_${request.path.slice(1)}`;
            const normalized = profile.validate(capability, args, request.idempotencyKey);
            const command = profile.validators.normalizeCommand({ capability, args,
              authority: { actorId: invocation.actorId, storageScopeId: scope }, derivation: binding,
              ...(request.idempotencyKey === undefined ? {} : { envelopeKey: request.idempotencyKey }),
            });
            await assertArtifactReplayMigration(legacyRecords, command, invocation, String(normalized.idempotencyKey));
            const existing = await pool.query(
              "SELECT 1 FROM artifacts.operation_receipts WHERE storage_scope_id=$1 AND internal_key=$2",
              [scope, command.identity.internalKey]);
            if (existing.rows.length > 0) {
              // This is a presence probe only. The coordinator rereads the receipt
              // under locks and revalidates current rights, without reserving again.
              if (command.operation === "publish") return replayPublication({ pool, coordinator, command, invocation,
                ...(options.publicationUrls ? { publicationUrls: options.publicationUrls } : {}) });
              return app.execute(request, invocation);
            }
            if (!await reserveArtifactAttempt(pool, scope, invocation.actorId)) {
              return rateLimitedOutcome(invocation.invocationId, command.operation);
            }
          }
          return app.execute(request, invocation);
        })));
    } catch (cause) {
      const failure = classifyArtifactFailure(cause, { invocationId: invocation.invocationId,
        operation: request.path.slice(1), phase: "dispatch", commitState: "not_committed" },
      (error) => error instanceof ArtifactProfileInputError ? new ArtifactOperationError(error.category) : mapHostError(error));
      if (cause instanceof CommitQuarantineError) {
        const quarantine = { ...failure, kind: "operational" as const, category: "provider_unavailable" as const,
          variant: "legacy_quarantine", httpStatus: 503, publicCode: "capability_unavailable", retriable: false };
        Object.defineProperty(quarantine, "cause", { value: cause });
        return { ok: false, failure: quarantine };
      }
      return { ok: false, failure };
    }
  };
  return { app: { ...app, execute, handle: async (request, invocation) =>
    projectArtifactHttpOutcome(await execute(request, invocation)) } as typeof app, execute, store, publication };
}
