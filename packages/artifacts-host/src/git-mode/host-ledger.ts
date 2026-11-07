import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { canonicalManifest, manifestDigest } from "@sentropic/artifacts/codecs";
import { mimeTypeForPath } from "@sentropic/artifacts/server/mime";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { createPostgresPublicationUnitWriter, type PublicationBlobStore } from "@sentropic/artifacts/server/publication";
import { createPostgresHostJobStore } from "./host-jobs.js";
import { composeGitAccess, readGitModeConfig, type GitModeConfig } from "./compose.js";
import { IMMO_GIT_OUTPUT_DIR, IMMO_GIT_REPO_ID } from "./registry.js";

/**
 * SG4b host build ledger (A-LIVE v2 §8.3-8.4, D0), over the immo tables of
 * 0039_artifacts_host_build_ledger.
 *
 * Implements the `HostLedger` and `AcceptOptions` (`view`, `publish`)
 * contract of `@sentropic/artifacts/live-host` (types mirrored below from
 * sentropic feat/artifacts-live-host 8ce4700e4; TODO(0.2.20): import them from
 * the package and delete the mirrors). `transaction(jobKey, work)` runs
 * `work` in ONE Postgres transaction: `view` and `publish` reuse that
 * transaction's client, so the recheck, the release, its blobs references,
 * the current pointer, the git release index, the binding baseline, the job
 * state and the stored receipt commit or roll back together. A replay of a
 * committed job key returns the stored receipt; nothing is written twice.
 */

// --- Mirrors of @sentropic/artifacts/live-host (8ce4700e4) -----------------
export interface AttemptFence { runId: string; attempt: number }
export interface HostJob { jobId: string; generation: number; headSha: string; expectedReleaseId: string | null }
export interface HostRecheckView {
  scopeId: string;
  killSwitch: boolean;
  imageAllowlist: readonly string[];
  currentReleaseId: string | null;
  headReachable: boolean;
  binding: { artifactId: string; state: string; generation: number; executor: string; autoPublish: boolean;
    pendingJobId: string | null; pendingCommitSha: string | null };
  job: { jobId: string; state: string; bindingGeneration: number; commitSha: string; expectedCurrentReleaseId: string | null;
    fence: AttemptFence | null } | undefined;
  policy: { ownerAuthorized: boolean; automaticAuthorized: boolean; automaticEligible: boolean };
}
export interface HandoffClaims {
  v: 1; kid: string; scopeId: string; artifactId: string; jobId: string; kind: "explicit" | "idle"; runId: string;
  attempt: number; generation: number; commitSha: string; treeSha: string; tuple: { builderImageDigest: string } & Record<string, unknown>;
  candidateDigest: string; expectedReleaseId: string | null; nonce: string; sealedAt: number; expiresAt: number;
}
export interface HandoffReceipt {
  v: 1; kid: string; nonce: string; scopeId: string; artifactId: string; jobId: string; runId: string; attempt: number;
  commitSha: string; candidateDigest: string; releaseId: string; manifestDigest: string; committedAt: number; signature: string;
}
export interface CandidateFile { readonly path: string; readonly bytes: Uint8Array }
// ---------------------------------------------------------------------------

/** Actor recorded on the binding audit for a builder publication. */
export const SANDBOX_PUBLISHER = "sentropic:sandbox-builder" as const;

export interface HostBuildLedgerOptions {
  readonly pool: pg.Pool;
  readonly scopeId: string;
  readonly blobs: PublicationBlobStore;
  /** Provider `candidateDigest` (live-host): the stored bytes are digested exactly like the claim. */
  readonly candidateDigest: (files: readonly CandidateFile[]) => string;
  /** The required commit is reachable on the bound branch (forge, observed at call time). */
  readonly headReachable: (binding: { repoId: string; branch: string; subPath: string; principalId: string },
    commitSha: string) => Promise<boolean>;
  /** Current owner authority for an explicit publication: code rights and an approved account. */
  readonly ownerAuthorized: (principalId: string) => Promise<boolean>;
  /** Exact builder image digests admitted (A-LIVE §8.1). Empty: every handoff is refused. */
  readonly imageAllowlist: readonly string[];
  /** Operator pause of sandbox publication. */
  readonly killSwitch: () => boolean;
  /**
   * Typed refusal of the provider (`new LiveHostError(code, reason)` of
   * live-host), so `refusalOf` answers a closed body the builder does not
   * retry forever, and the transaction rolls back with nothing stored.
   */
  readonly refuse: (code: "handoff_mismatch", reason: "release_conflict" | "policy_refused" | "job_not_pending") => Error;
  readonly now?: () => number;
}

interface JobRow {
  job_id: string; storage_scope_id: string; artifact_id: string; repo_id: string; branch: string; sub_path: string;
  commit_sha: string; binding_generation: string | number; expected_current_release_id: string | null; state: string;
  requested_by: string; fence_run_id: string | null; fence_attempt: number | null;
}
interface BindingRow {
  artifact_id: string; repo_id: string; branch: string; sub_path: string; state: string; generation: number; executor: string;
  auto_publish: boolean; pending_job_id: string | null; pending_commit_sha: string | null; personal_principal_id: string | null;
  release_commit_sha: string | null; version: number;
}

type Client = pg.PoolClient;

async function inTransaction<T>(pool: pg.Pool, work: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createPostgresHostBuildLedger(options: HostBuildLedgerOptions) {
  const { pool, scopeId } = options;
  const now = options.now ?? Date.now;
  const current = new AsyncLocalStorage<Client>();
  const txClient = (): Client => {
    const client = current.getStore();
    if (!client) throw new Error("host_ledger_outside_transaction");
    return client;
  };

  async function lockedRows(client: Client, artifactId: string, jobId: string) {
    const binding = (await client.query<BindingRow>(`SELECT artifact_id, repo_id, branch, sub_path, state, generation, executor,
      auto_publish, pending_job_id, pending_commit_sha, personal_principal_id, release_commit_sha, version
      FROM artifacts.git_bindings WHERE artifact_id = $1 AND storage_scope_id = $2 FOR UPDATE`, [artifactId, scopeId])).rows[0];
    const job = (await client.query<JobRow>(`SELECT * FROM artifacts.host_build_jobs
      WHERE job_id = $1 AND storage_scope_id = $2 AND artifact_id = $3 FOR UPDATE`, [jobId, scopeId, artifactId])).rows[0];
    const pointer = (await client.query<{ release_id: string }>(
      "SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1", [artifactId])).rows[0];
    return { binding, job, currentReleaseId: pointer?.release_id ?? null };
  }

  function toView(rows: Awaited<ReturnType<typeof lockedRows>>, extra: { headReachable: boolean; ownerAuthorized: boolean }): HostRecheckView {
    const { binding, job } = rows;
    return {
      scopeId, killSwitch: options.killSwitch(), imageAllowlist: [...options.imageAllowlist],
      currentReleaseId: rows.currentReleaseId, headReachable: extra.headReachable,
      binding: binding ? { artifactId: binding.artifact_id, state: binding.state, generation: Number(binding.generation),
        executor: binding.executor, autoPublish: binding.auto_publish, pendingJobId: binding.pending_job_id,
        pendingCommitSha: binding.pending_commit_sha }
        : { artifactId: "", state: "detached", generation: 0, executor: "", autoPublish: false, pendingJobId: null, pendingCommitSha: null },
      job: job ? { jobId: job.job_id, state: job.state, bindingGeneration: Number(job.binding_generation), commitSha: job.commit_sha,
        expectedCurrentReleaseId: job.expected_current_release_id,
        fence: job.fence_run_id && job.fence_attempt ? { runId: job.fence_run_id, attempt: job.fence_attempt } : null } : undefined,
      // No automatic (idle) publication from this host yet: only explicit owner publications pass.
      policy: { ownerAuthorized: extra.ownerAuthorized, automaticAuthorized: false, automaticEligible: false },
    };
  }

  const jobs = createPostgresHostJobStore({ pool, scopeId, now });

  return {
    jobs,
    /** Builder job resolution: lock the rows, let the provider decide (`resolvePendingJob`), persist the admitted fence. */
    async admitJob(artifactId: string, jobId: string,
      decide: (view: HostRecheckView) => { job: HostJob; fence: AttemptFence } | null): Promise<HostJob | null> {
      return inTransaction(pool, async (client) => {
        const rows = await lockedRows(client, artifactId, jobId);
        const decided = decide(toView(rows, { headReachable: false, ownerAuthorized: false }));
        if (!decided) return null;
        await client.query(`UPDATE artifacts.host_build_jobs SET state = 'building', fence_run_id = $2, fence_attempt = $3,
          updated_at = $4 WHERE job_id = $1`, [jobId, decided.fence.runId, decided.fence.attempt, new Date(now()).toISOString()]);
        return decided.job;
      });
    },
    ledger: {
      async find(jobKey: string): Promise<HandoffReceipt | undefined> {
        const row = (await pool.query<{ receipt: HandoffReceipt }>(
          "SELECT receipt FROM artifacts.host_build_receipts WHERE job_key = $1", [jobKey])).rows[0];
        return row?.receipt;
      },
      async transaction(jobKey: string, work: () => Promise<HandoffReceipt>): Promise<HandoffReceipt> {
        return inTransaction(pool, async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`host-build:${jobKey}`]);
          const stored = (await client.query<{ receipt: HandoffReceipt }>(
            "SELECT receipt FROM artifacts.host_build_receipts WHERE job_key = $1", [jobKey])).rows[0];
          if (stored) return stored.receipt;
          const receipt = await current.run(client, work);
          await client.query(`INSERT INTO artifacts.host_build_receipts (job_key, storage_scope_id, artifact_id, job_id, release_id,
            nonce, receipt, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [jobKey, scopeId, receipt.artifactId, receipt.jobId,
            receipt.releaseId, receipt.nonce, JSON.stringify(receipt), new Date(now()).toISOString()]);
          return receipt;
        });
      },
    },
    /** AcceptOptions.view: the locked durable state, inside the ledger transaction. */
    async view(claims: HandoffClaims): Promise<HostRecheckView> {
      const client = txClient();
      const rows = await lockedRows(client, claims.artifactId, claims.jobId);
      const owner = rows.binding?.personal_principal_id ?? null;
      const ownerAuthorized = owner !== null && rows.job?.requested_by === owner && await options.ownerAuthorized(owner);
      const headReachable = rows.binding !== undefined && owner !== null && await options.headReachable({
        repoId: rows.binding.repo_id, branch: rows.binding.branch, subPath: rows.binding.sub_path, principalId: owner },
      claims.commitSha).catch(() => false);
      return toView(rows, { headReachable, ownerAuthorized });
    },
    /** AcceptOptions.publish: exact bytes, release + index + pointer + baseline + job state, stored bytes re-read. */
    async publish(claims: HandoffClaims, files: readonly CandidateFile[]) {
      const client = txClient();
      const artifact = (await client.query<{ owner_id: string; lifecycle_state: string }>(
        "SELECT owner_id, lifecycle_state FROM artifacts.artifacts WHERE id = $1 AND storage_scope_id = $2", [claims.artifactId, scopeId])).rows[0];
      if (!artifact || artifact.lifecycle_state !== "active") throw options.refuse("handoff_mismatch", "policy_refused");
      const rows = await lockedRows(client, claims.artifactId, claims.jobId);
      if (!rows.binding || !rows.job) throw options.refuse("handoff_mismatch", "job_not_pending");
      const entries = files.map((file) => {
        const hex = createHash("sha256").update(file.bytes).digest("hex");
        return { file, hex, digest: `sha256:${hex}`, key: `artifacts/${scopeId}/blobs/sha256/${hex}`,
          mimeType: mimeTypeForPath(file.path) ?? "application/octet-stream" };
      });
      for (const entry of entries) await options.blobs.putBlob(entry.key, entry.file.bytes);
      const stored: CandidateFile[] = [];
      for (const entry of entries) {
        const bytes = await options.blobs.getBlob(entry.key);
        if (!bytes) throw new ArtifactOperationError("provider_unavailable");
        stored.push({ path: entry.file.path, bytes: new Uint8Array(bytes) });
      }
      const storedDigest = options.candidateDigest(stored);
      const body = { schemaVersion: "artifacts/v1", artifactId: claims.artifactId, storageScopeId: scopeId, ownerId: artifact.owner_id,
        profile: {}, files: entries.map((entry) => ({ path: entry.file.path, digest: entry.digest, size: entry.file.bytes.byteLength,
          mimeType: entry.mimeType })) };
      const digest = manifestDigest(body);
      const manifest = canonicalManifest({ ...body, digest });
      const unit = createPostgresPublicationUnitWriter(client as never);
      const pointer = await unit.lockCurrent(claims.artifactId);
      if (pointer.currentReleaseId !== claims.expectedReleaseId) throw options.refuse("handoff_mismatch", "release_conflict");
      const releaseId = randomUUID();
      const at = new Date(now()).toISOString();
      await unit.putRelease({ releaseId, artifactId: claims.artifactId, manifestDigest: digest, manifest, state: "ready",
        createdAt: at, authorPrincipalId: rows.job.requested_by, parentReleaseId: pointer.currentReleaseId });
      await client.query("UPDATE artifacts.releases SET git_commit = $2 WHERE id = $1", [releaseId, claims.commitSha]);
      for (const entry of [...new Map(entries.map((e) => [e.digest, e])).values()]) {
        await unit.registerBlob(scopeId, entry.digest, entry.file.bytes.byteLength);
        await unit.addReleaseRef(entry.digest, releaseId);
      }
      await unit.promoteCurrentLatestWins(claims.artifactId, releaseId);
      await client.query(`INSERT INTO artifacts.git_release_index (release_id, artifact_id, storage_scope_id, repo_id, branch,
        commit_sha, tree_sha, manifest_digest, candidate_digest, executor, verification, receipt_id, job_id, build_run_id, attempt,
        created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'sandbox','builder-attested',$10,$11,$12,$13,$14)`,
      [releaseId, claims.artifactId, scopeId, rows.binding.repo_id, rows.binding.branch, claims.commitSha, claims.treeSha || null,
        digest, claims.candidateDigest, claims.nonce, claims.jobId, claims.runId, claims.attempt, at]);
      const baseline = await client.query(`UPDATE artifacts.git_bindings SET state = 'attached', release_commit_sha = $3,
        pending_job_id = NULL, pending_commit_sha = NULL, version = version + 1, updated_at = $4
        WHERE artifact_id = $1 AND storage_scope_id = $2 AND pending_job_id = $5 AND generation = $6 AND state = 'build_pending'`,
      [claims.artifactId, scopeId, claims.commitSha, at, claims.jobId, claims.generation]);
      if (baseline.rowCount !== 1) throw options.refuse("handoff_mismatch", "job_not_pending");
      await client.query(`INSERT INTO artifacts.git_binding_events (artifact_id, storage_scope_id, actor_id, action, before_sha,
        after_sha, invocation_id, created_at) VALUES ($1,$2,$3,'publish',$4,$5,$6,$7)`,
      [claims.artifactId, scopeId, SANDBOX_PUBLISHER, rows.binding.release_commit_sha, claims.commitSha, claims.runId, at]);
      await client.query("UPDATE artifacts.host_build_jobs SET state = 'published', updated_at = $2 WHERE job_id = $1", [claims.jobId, at]);
      return { releaseId, manifestDigest: digest, storedDigest };
    },
  };
}
export type PostgresHostBuildLedger = ReturnType<typeof createPostgresHostBuildLedger>;

/**
 * Production composition of the ledger from the git mode configuration
 * (radar-api, stage `build`+ only):
 * - `candidateDigest` from the provider live-host subpath; absent (0.2.18):
 *   no ledger, the endpoints answer 503;
 * - head reachability through the immo GitPort (lease from SG0-app);
 * - owner authority: current code rights of the binding owner;
 * - IMMO_ARTIFACTS_BUILDER_IMAGE_ALLOWLIST: exact builder image digests,
 *   comma-separated (empty: every handoff refused with image_not_allowed);
 * - IMMO_ARTIFACTS_SANDBOX_PUBLICATION_PAUSED=true: operator kill switch.
 */
export function composeHostBuildLedger(input: {
  readonly pool: pg.Pool; readonly storageScopeId: string; readonly blobs: PublicationBlobStore;
  readonly module: { readonly candidateDigest?: unknown; readonly LiveHostError?: unknown } | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly config?: GitModeConfig;
}): PostgresHostBuildLedger | undefined {
  const candidateDigest = input.module?.candidateDigest;
  const LiveHostError = input.module?.LiveHostError;
  if (typeof candidateDigest !== "function" || typeof LiveHostError !== "function") return undefined;
  const access = composeGitAccess({ pool: input.pool, storageScopeId: input.storageScopeId,
    config: input.config ?? readGitModeConfig(input.env) });
  return createPostgresHostBuildLedger({ pool: input.pool, scopeId: input.storageScopeId, blobs: input.blobs,
    candidateDigest: candidateDigest as (files: readonly CandidateFile[]) => string,
    imageAllowlist: (input.env.IMMO_ARTIFACTS_BUILDER_IMAGE_ALLOWLIST ?? "").split(",").map((entry) => entry.trim()).filter(Boolean),
    killSwitch: () => input.env.IMMO_ARTIFACTS_SANDBOX_PUBLICATION_PAUSED === "true",
    refuse: (code, reason) => new (LiveHostError as new (code: string, reason?: string) => Error)(code, reason),
    ownerAuthorized: (principalId) => access.codeRights.canReadCode({ storageScopeId: input.storageScopeId,
      repoId: IMMO_GIT_REPO_ID, actorId: principalId }),
    async headReachable(binding, commitSha) {
      const target = { storageScopeId: input.storageScopeId, repoId: binding.repoId, branch: binding.branch,
        subPath: binding.subPath, principalId: binding.principalId, outputDir: IMMO_GIT_OUTPUT_DIR };
      const head = await access.git.resolveRef(target, binding.branch);
      return head === commitSha || await access.git.isAncestor(target, commitSha, head);
    } });
}
