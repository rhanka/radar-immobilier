import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import { createPostgresArtifactStore, createPostgresLegacyArtifactRecords } from "@sentropic/artifacts/adapters/postgres";
import { createPostgresCommitExecutor } from "@sentropic/artifacts/adapters/postgres-commit";
import { createHttpArtifactApp, projectArtifactHttpOutcome, type HttpAppDeps } from "@sentropic/artifacts/http";
import type { StagingStore, UploadSignerPort, UploadSessionStore } from "@sentropic/artifacts/server/uploads";
import { createPostgresReaderConsentStore } from "@sentropic/artifacts/adapters/postgres-reader-consent";
import { createAccountDirectory } from "./directory.js";
import { ArtifactProfileInputError, createRadarKeyDerivation } from "@sentropic/artifacts/mcp-core";
import { createLifecycleService } from "@sentropic/artifacts/server/lifecycle";
import { createPostgresClaimGuardedRefs } from "@sentropic/artifacts/server/gc";
import { createPostgresPublicationUnitWriter, createPublicationService } from "@sentropic/artifacts/server/publication";
import { CommitQuarantineError, type ArtifactInvocationContext, type FinalizeTxClient } from "@sentropic/artifacts/server/commit-contract";
import { ArtifactOperationError, classifyArtifactFailure } from "@sentropic/artifacts/server/outcome-contract";
import { assertArtifactReplayMigration } from "@sentropic/artifacts/server/idempotency";
import { mapHostError, normalizeHostOutcome } from "./host-outcome.js";
import { rateLimitedOutcome, reserveArtifactAttempt } from "./attempt-admission.js";
import {
  ARTIFACT_P0B, assertPageTextUploadArgs, extractEnvelopeV1Metadata, getPendingArtifactMetadata,
  isArtifactMutation, isArtifactPublication,
} from "./p0b-profile.js";
import { isPageTextMimeType, PUBLISH_MAX_FILE_BYTES } from "./publish-policy.js";
import { assertP0bStorage, p0bPorts, sharePrincipal } from "./p0b-ports.js";
import type { ArtifactDeleteConfirmation } from "./delete-confirmation.js";
import { createArtifactReadMetadata } from "./read-metadata.js";
import { replayLegacyDelete } from "./legacy-delete-replay.js";
import type { GitModeDeps } from "./git-mode/compose.js";

/** Read paths that reconcile a pending build on demand before serving (package contract, 0.2.25). */
const RECONCILE_ON_DEMAND_PATHS: ReadonlySet<string> = new Set(["/live_status", "/git_publish", "/get"]);

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

/**
 * Derive the preparation window from the publish blob deadline, preserving the
 * invariant `blobDeadlineMs + PUBLISH_FINALIZE_MARGIN_MS === preparationWindowMs`:
 * every blob operation must finish strictly inside the window so the
 * finalization transaction still fits before the preparation sweeper may
 * reclaim the staged blobs (and `completeIntent` refuses an expired
 * preparation). A longer window holds no contended resource: no key lock or
 * leased connection spans S3 I/O, and longer only delays the reclaim of
 * crashed publishes.
 */
export function resolvePublishDeadlines(blobDeadlineMs: number = PUBLISH_BLOB_DEADLINE_MS): {
  readonly blobDeadlineMs: number; readonly preparationWindowMs: number;
} {
  return { blobDeadlineMs, preparationWindowMs: blobDeadlineMs + PUBLISH_FINALIZE_MARGIN_MS };
}

async function assertResolvedBundlePageTextBudget(input: {
  readonly normalized: Record<string, unknown>;
  readonly isV2: boolean;
  readonly actorId: string;
  readonly scope: string;
  readonly store: ReturnType<typeof createPostgresArtifactStore>;
  readonly publication: ReturnType<typeof createPublicationService>;
  readonly sessions: UploadSessionStore | undefined;
}): Promise<void> {
  const artifactId = String(input.normalized.artifactId ?? "");
  const acl = await input.store.getArtifactAcl(artifactId);
  if (!acl || acl.storageScopeId !== input.scope || acl.ownerId !== input.actorId) return;
  const explicitPaths = new Set<string>();
  let pageTextBytes = 0;
  const addPageTextSize = (size: number) => {
    if (size > PUBLISH_MAX_FILE_BYTES) throw new ArtifactProfileInputError();
    pageTextBytes += size;
    if (pageTextBytes > PUBLISH_MAX_FILE_BYTES) throw new ArtifactProfileInputError();
  };
  for (const file of (input.normalized.files as Array<{ path: string; mimeType: string; bytes: readonly number[] }> | undefined) ?? []) {
    explicitPaths.add(file.path);
    if (isPageTextMimeType(file.mimeType)) addPageTextSize(file.bytes.length);
  }
  const readReleaseManifest = async (targetArtifactId: string, releaseId?: string) => {
    const release = releaseId !== undefined
      ? await input.publication.getRelease(releaseId)
      : await input.publication.getCurrent(targetArtifactId);
    if (!release || release.artifactId !== targetArtifactId) return undefined;
    try {
      return JSON.parse(release.manifest) as { files?: Array<{ path: string; mimeType: string; size: number }> };
    } catch {
      return undefined;
    }
  };
  for (const asset of (input.normalized.assets as Array<Record<string, unknown>> | undefined) ?? []) {
    const path = String(asset.path ?? "");
    explicitPaths.add(path);
    if (Object.hasOwn(asset, "uploadId") && input.sessions) {
      const staged = await input.sessions.getStagedFile(String(asset.uploadId));
      if (staged && staged.artifactId === artifactId && isPageTextMimeType(staged.mimeType)) {
        addPageTextSize(staged.size);
      }
    } else if (input.isV2 && (Object.hasOwn(asset, "sourceArtifactId") || Object.hasOwn(asset, "carryFromReleaseId"))) {
      const sourceArtifactId = Object.hasOwn(asset, "sourceArtifactId") ? String(asset.sourceArtifactId) : artifactId;
      const sourceAcl = sourceArtifactId === artifactId ? acl : await input.store.getArtifactAcl(sourceArtifactId);
      if (!sourceAcl || sourceAcl.storageScopeId !== input.scope) continue;
      const releaseId = typeof asset.carryFromReleaseId === "string" ? asset.carryFromReleaseId
        : typeof asset.sourceReleaseId === "string" ? asset.sourceReleaseId : undefined;
      const manifest = await readReleaseManifest(sourceArtifactId, releaseId);
      const wanted = typeof asset.sourcePath === "string" ? asset.sourcePath : path;
      const entry = manifest?.files?.find((candidate) => candidate.path === wanted);
      if (entry && isPageTextMimeType(entry.mimeType)) addPageTextSize(entry.size);
    } else if (isPageTextMimeType(asset.mimeType) && typeof asset.size === "number") {
      addPageTextSize(asset.size);
    }
  }
  if (input.isV2 && input.normalized.keepUnmodifiedPaths === true &&
    typeof input.normalized.expectedCurrentReleaseId === "string") {
    const manifest = await readReleaseManifest(artifactId, input.normalized.expectedCurrentReleaseId);
    for (const entry of manifest?.files ?? []) {
      if (!explicitPaths.has(entry.path) && isPageTextMimeType(entry.mimeType)) {
        addPageTextSize(entry.size);
      }
    }
  }
}

export async function createCommitDomain(options: Pick<HttpAppDeps, "profile" | "coordinator"> & {
  pool: pg.Pool; scope: string; blobs: HttpAppDeps["publication"]["blobs"];
  publicationUrls?: HttpAppDeps["publicationUrls"];
  confirmation?: ArtifactDeleteConfirmation;
  /** Files parity — upload session ledger, staging bytes and presigned PUT signer. */
  uploads?: { sessions: UploadSessionStore; staging: StagingStore; signer: UploadSignerPort };
  /** Files parity LOT 2 — browser upload page host wiring (required under P0B). */
  uploadPage?: HttpAppDeps["uploadPage"];
  /** Preparation window; defaults to PREPARATION_WINDOW_MS. Derive it with resolvePublishDeadlines. */
  preparationWindowMs?: number;
  /** Git mode dependencies (deps.git, gitTools); empty when IMMO_ARTIFACTS_GIT_MODE is off. */
  gitMode?: GitModeDeps;
}) {
  const { pool, scope, blobs, profile, coordinator } = options;
  const preparationWindowMs = options.preparationWindowMs ?? PREPARATION_WINDOW_MS;
  await assertP0bStorage(pool, options.confirmation);
  const store = createPostgresArtifactStore(pool);
  const reads = createArtifactReadMetadata(pool, scope, options.publicationUrls);
  const publication = createPublicationService({ state: store, blobs, intents: store });
  const keyDomain = new AsyncLocalStorage<ReturnType<typeof createRadarKeyDerivation>>();
  const artifact = new AsyncLocalStorage<string>();
  const legacyRecords = createPostgresLegacyArtifactRecords(pool);
  const approved = new AsyncLocalStorage<ReadonlySet<string>>();
  const lock = (table: string, column: string) => async (client: FinalizeTxClient) => {
    await client.query(`SELECT ${column} FROM artifacts.${table} WHERE ${column} = $1 FOR UPDATE`,
      [artifact.getStore()]);
  };
  const publicationRefs = createPostgresClaimGuardedRefs(store, createPostgresCommitExecutor(pool));
  // Host triggers only (pending-build sweep, live re-drive timer): never handed to the provider app.
  const { pendingBuilds, liveRedrive: _hostTimerOnly, ...gitDeps } = options.gitMode ?? {};
  const app = createHttpArtifactApp({ profile, coordinator, mapHostError,
    ...(options.uploadPage ? { uploadPage: options.uploadPage } : {}),
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
      async resolveBinding(client, binding) {
        try {
          return await createPostgresArtifactStore(client as unknown as pg.Pool).ensureArtifact({ ...binding, profile: {} });
        } catch (cause) {
          // The coordinator accepts operational refusals; preserve terminal identity as 410.
          if (ARTIFACT_P0B && cause instanceof ArtifactOperationError && String(cause.kind) === "gone") {
            throw new ArtifactOperationError("unauthorized_at_commit", { cause, refusal: {
              allowed: false, reason: "denied", publicCode: "gone", status: 410, retriable: false } });
          }
          throw cause;
        }
      },
      async abandonAttempt() { /* Ensure stages no external objects. */ },
    },
    acls: { ...store, listArtifactIds: reads.listArtifactIds }, lifecycle: createLifecycleService(store, undefined, store),
    ...p0bPorts(store, options.confirmation, (sub) => approved.getStore()?.has(sub) === true),
    // I2 on G2 — opaque userRef directory over approved immo accounts.
    directory: createAccountDirectory(pool),
    // Reader consent LOT 1 — persistent consent through the generic host
    // port; absent the port the provider fails the revoke route closed with
    // capability_unavailable.
    readerConsent: createPostgresReaderConsentStore(pool),
    ...(options.uploads ? { uploads: { ...options.uploads, idempotency: store } } : {}),
    publication: { blobs, intents: store, refs: publicationRefs,
      cleanupWindowMs: preparationWindowMs, createUnitWriter: createPostgresPublicationUnitWriter, getCurrent: publication.getCurrent,
      getRelease: publication.getRelease, listReleases: publication.listReleases,
      locks: { "artifact-lifecycle": [lock("artifacts", "id")], acl: [lock("artifact_access", "artifact_id")],
        "current-pointer": [lock("artifact_current", "artifact_id")] } },
    ...(options.publicationUrls ? { publicationUrls: options.publicationUrls } : {}),
    ...gitDeps,
  });
  const execute: typeof app.execute = async (request, invocation: ArtifactInvocationContext) => {
    try {
      const actors = await pool.query<{ sub: string; status?: string }>("SELECT sub, status FROM account_users ORDER BY sub");
      const binding = createRadarKeyDerivation({ storageScopeId: scope, actorIds: actors.rows.map((row) => row.sub) });
      const routeCapability = request.method === "POST"
        ? (profile.capabilityForRoute(request.method, request.path) ?? `artifacts_${request.path.slice(1)}`)
        : undefined;
      const envelopeVersion = (profile.resultEnvelopeVersion ?? 1) as 1 | 2;
      const extractedMeta = routeCapability
        ? extractEnvelopeV1Metadata(routeCapability, request.body, envelopeVersion)
        : { strippedArgs: request.body, metadata: undefined };
      const pendingMeta = extractedMeta.metadata ?? getPendingArtifactMetadata();
      if (extractedMeta.metadata !== undefined) {
        request = { ...request, body: extractedMeta.strippedArgs };
      }
      if (request.method === "POST" && request.path === "/uploads/create" &&
        request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
        const createBody = request.body as Record<string, unknown>;
        if (isPageTextMimeType(createBody.mimeType)) {
          if (Object.hasOwn(createBody, "maxSize")) {
            if (typeof createBody.maxSize !== "number" || !Number.isSafeInteger(createBody.maxSize) ||
              createBody.maxSize < 1 || createBody.maxSize > PUBLISH_MAX_FILE_BYTES) {
              throw new ArtifactProfileInputError();
            }
          } else {
            request = { ...request, body: { ...createBody, maxSize: PUBLISH_MAX_FILE_BYTES } };
          }
        }
      }
      if (request.method === "POST" && request.path === "/uploads/commit" &&
        request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
        const commitBody = request.body as Record<string, unknown>;
        if (isPageTextMimeType(commitBody.mimeType) &&
          typeof commitBody.size === "number" && commitBody.size > PUBLISH_MAX_FILE_BYTES) {
          throw new ArtifactProfileInputError();
        }
      }
      if (ARTIFACT_P0B && !profile.requireExpectedCurrentReleaseId && request.path === "/delete" && request.body && typeof request.body === "object" &&
        !Array.isArray(request.body) && !Object.hasOwn(request.body, "expectedCurrentReleaseId")) {
        request = { ...request, body: await options.confirmation!.prepareDelete(invocation.actorId, request.body as Record<string, unknown>) };
      }
      const body = request.body as { artifactId?: string } | undefined;
      return normalizeHostOutcome(await sharePrincipal.run(request.body as { action?: unknown; principalId?: unknown } ?? {}, () =>
        approved.run(new Set(actors.rows.filter((r) => r.status === "approved").map((r) => r.sub)), () => keyDomain.run(binding,
        () => artifact.run(body?.artifactId ?? "", async () => {
          const write = request.method === "POST" && isArtifactMutation(request.path.slice(1));
          if (write && invocation.actorId && invocation.storageScopeId === scope &&
            request.actorId === invocation.actorId &&
            (request.storageScopeId === undefined || request.storageScopeId === scope)) {
            const args = { ...request.body as Record<string, unknown> };
            if (args.storageScopeId !== undefined && args.storageScopeId !== scope) return app.execute(request, invocation);
            delete args.storageScopeId;
            const capability = routeCapability ?? `artifacts_${request.path.slice(1)}`;
            const normalized = profile.validate(capability, args, request.idempotencyKey, { deferPrecondition: true });
            assertPageTextUploadArgs(capability, normalized as Record<string, unknown>);
            if (request.path === "/publish_bundle" || request.path === "/publish_bundle_v2") {
              await assertResolvedBundlePageTextBudget({
                normalized: normalized as Record<string, unknown>,
                isV2: request.path === "/publish_bundle_v2",
                actorId: invocation.actorId,
                scope,
                store,
                publication,
                sessions: options.uploads?.sessions,
              });
            }
            // The provider owns historical decoding, authorization and the required-field error.
            if (profile.requireExpectedCurrentReleaseId && ["/publish", "/revert", "/delete"].includes(request.path) &&
              !Object.hasOwn(args, "expectedCurrentReleaseId")) {
              if (request.path === "/delete") {
                const replay = await replayLegacyDelete({ pool, profile, coordinator, invocation, args, derivation: binding });
                if (replay !== undefined) return replay;
              }
              return app.execute(request, invocation);
            }
            // The provider command layer only knows the durable-command writers
            // (ensure/publish/set_access/delete/revert/commit_upload/
            // publish_bundle/publish_bundle_v2): it throws
            // capability_unavailable for anything else. Capabilities without
            // provider command identity (revoke_reader_consent) keep the
            // required idempotencyKey at the schema layer but skip the
            // receipt probe and the attempt quota, like the quota-bounded
            // create_upload session mint; the provider executes them outside
            // the coordinator and they are naturally idempotent.
            const command = (profile.idempotency as Partial<Record<string, unknown>>)[capability] === undefined
              ? undefined : profile.validators.normalizeCommand({ capability, args,
                authority: { actorId: invocation.actorId, storageScopeId: scope }, derivation: binding,
                ...(request.idempotencyKey === undefined ? {} : { envelopeKey: request.idempotencyKey }),
              });
            if (command !== undefined) {
              if (isArtifactPublication(command.operation)) await assertArtifactReplayMigration(legacyRecords, command, invocation, String(normalized.idempotencyKey));
              const existing = await pool.query(
                "SELECT 1 FROM artifacts.operation_receipts WHERE storage_scope_id=$1 AND internal_key=$2",
                [scope, command.identity.internalKey]);
              if (existing.rows.length > 0) {
                // This is a presence probe only. The coordinator rereads the receipt
                // under locks and revalidates current rights, without reserving again.
                return app.execute(request, invocation);
              }
              if (!await reserveArtifactAttempt(pool, scope, invocation.actorId)) {
                return rateLimitedOutcome(invocation.invocationId, command.operation);
              }
            }
          }
          // On-demand pending-build reconciliation (0.2.25): a builder failure
          // closes the job and the binding before the read paths serve, so a
          // stuck `build_pending` never blocks the next git_publish. A
          // reconcile outage never fails the request itself.
          if (pendingBuilds && body?.artifactId && RECONCILE_ON_DEMAND_PATHS.has(request.path)) {
            try {
              await pendingBuilds.reconcileArtifact(body.artifactId);
            } catch {
              console.error(JSON.stringify({ kind: "artifacts.reconcile_unavailable", path: request.path }));
            }
          }
          const outcome = await reads.project(request, () => app.execute(request, invocation));
          if (outcome.ok && pendingMeta !== undefined && envelopeVersion !== 2) {
            const resultBody = outcome.result.body as Record<string, unknown>;
            const targetId = typeof resultBody.artifactId === "string" ? resultBody.artifactId : body?.artifactId;
            if (typeof targetId === "string" && targetId.length > 0) {
              const shouldWrite = !outcome.replayed &&
                (request.path !== "/ensure" || resultBody.created !== false);
              const { rows } = shouldWrite
                ? await pool.query<{ metadata: Record<string, unknown> | null }>(
                  `UPDATE artifacts.artifacts SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
                   WHERE id = $1 AND storage_scope_id = $3 RETURNING metadata`,
                  [targetId, JSON.stringify(pendingMeta), scope],
                )
                : await pool.query<{ metadata: Record<string, unknown> | null }>(
                  "SELECT metadata FROM artifacts.artifacts WHERE id = $1 AND storage_scope_id = $2",
                  [targetId, scope],
                );
              const storedMeta = rows[0]?.metadata ?? pendingMeta;
              return { ...outcome, result: { ...outcome.result, body: { ...resultBody, ...storedMeta } } };
            }
          }
          return outcome;
        })))));
    } catch (cause) {
      const failure = classifyArtifactFailure(cause, { invocationId: invocation.invocationId,
        operation: request.path.slice(1), phase: "dispatch", commitState: "not_committed" },
      (error) => error instanceof ArtifactProfileInputError ? new ArtifactOperationError(error.category,
        error.details ? { publicDetails: error.details } : {}) : mapHostError(error));
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
    projectArtifactHttpOutcome(await execute(request, invocation), profile.resultEnvelopeVersion === 2) } as typeof app, execute, store, publication, publicationRefs };
}
