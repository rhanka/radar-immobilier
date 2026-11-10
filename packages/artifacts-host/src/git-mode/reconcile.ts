import type pg from "pg";
import type { GitBindingStore } from "@sentropic/artifacts";
import {
  reconcilePendingBuild, reconcilePendingBuilds, type HandoffReceipt, type HostLedger, type ReconcileBuilderStatus, type ReconcileItemResult,
  type ReconcileJobStore, type ReconcileOptions, type ReconcileReport, type ReconcileStatusClient,
} from "@sentropic/artifacts/live-host";
import type { HostBuildStatus } from "./build-api.js";

/**
 * Host ports and wiring for the package pending-build reconciler
 * (@sentropic/artifacts 0.2.25, `live-host`): the generic sweep stays in the
 * package; immo only adapts its builder client, its `host_build_jobs` table
 * and its handoff receipt ledger, and triggers the sweep on the threshold
 * timer plus on demand from the read paths (`live_status`, `git_publish`,
 * `artifacts_get`). No job row is ever deleted here.
 */

/** Status port: wraps `createHostBuildApiClient.status()`; a builder 404 answers undefined (unknown job). */
export function createReconcileStatusClient(build: {
  status(artifactId: string, jobId: string): Promise<HostBuildStatus | undefined>;
}): ReconcileStatusClient {
  return {
    async status({ artifactId, jobId }) {
      const answer = await build.status(artifactId, jobId);
      if (answer === undefined) return undefined;
      return { jobId: answer.jobId, state: answer.state as ReconcileBuilderStatus["state"],
        ...(answer.code !== undefined ? { code: answer.code } : {}),
        ...(answer.reason !== undefined ? { reason: answer.reason } : {}),
        ...(answer.releaseId !== undefined ? { releaseId: answer.releaseId } : {}) };
    },
  };
}

interface PendingRow { job_id: string; artifact_id: string; updated_at: Date | string }

/**
 * Job-store port over `artifacts.host_build_jobs` (0039 + failure columns of
 * 0043). Terminal moves are compare-and-swap from the pending states only:
 * one `UPDATE ... WHERE state IN ('build_pending','building')`.
 */
export function createPostgresReconcileJobStore(options: {
  readonly pool: pg.Pool; readonly scopeId: string; readonly now?: () => number;
}): ReconcileJobStore & {
  pendingForArtifact(artifactId: string): Promise<{ scopeId: string; artifactId: string; jobId: string } | undefined>;
} {
  const { pool, scopeId } = options;
  const now = options.now ?? Date.now;
  const readState = async (artifactId: string, jobId: string): Promise<string | undefined> =>
    (await pool.query<{ state: string }>(`SELECT state FROM artifacts.host_build_jobs
      WHERE storage_scope_id = $1 AND artifact_id = $2 AND job_id = $3`, [scopeId, artifactId, jobId])).rows[0]?.state;
  const moved = async (result: { rowCount: number | null }, artifactId: string, jobId: string) =>
    result.rowCount === 1 ? "updated" as const
      : await readState(artifactId, jobId) === undefined ? "not-found" as const : "already-terminal" as const;
  return {
    async listPending({ nowMs, olderThanMs, limit }) {
      const rows = (await pool.query<PendingRow>(`SELECT job_id, artifact_id, updated_at FROM artifacts.host_build_jobs
        WHERE storage_scope_id = $1 AND state IN ('build_pending','building') AND updated_at < $2
        ORDER BY updated_at ASC LIMIT $3`, [scopeId, new Date(nowMs - olderThanMs), limit])).rows;
      return rows.map((row) => ({ scopeId, artifactId: row.artifact_id, jobId: row.job_id,
        updatedAtMs: new Date(row.updated_at).getTime() }));
    },
    async read({ artifactId, jobId }) {
      const state = await readState(artifactId, jobId);
      return state === undefined ? undefined : { state };
    },
    async markFailed({ artifactId, jobId, code, reason }) {
      return moved(await pool.query(`UPDATE artifacts.host_build_jobs SET state = 'build_failed', code = $4, reason = $5,
        updated_at = $6 WHERE storage_scope_id = $1 AND artifact_id = $2 AND job_id = $3
        AND state IN ('build_pending','building')`,
      [scopeId, artifactId, jobId, code ?? null, reason ?? null, new Date(now())]), artifactId, jobId);
    },
    async markPublished({ artifactId, jobId }) {
      return moved(await pool.query(`UPDATE artifacts.host_build_jobs SET state = 'published', updated_at = $4
        WHERE storage_scope_id = $1 AND artifact_id = $2 AND job_id = $3 AND state IN ('build_pending','building')`,
      [scopeId, artifactId, jobId, new Date(now())]), artifactId, jobId);
    },
    async pendingForArtifact(artifactId) {
      const row = (await pool.query<{ job_id: string }>(`SELECT job_id FROM artifacts.host_build_jobs
        WHERE storage_scope_id = $1 AND artifact_id = $2 AND state IN ('build_pending','building')
        ORDER BY updated_at DESC LIMIT 1`, [scopeId, artifactId])).rows[0];
      return row ? { scopeId, artifactId, jobId: row.job_id } : undefined;
    },
  };
}

/** Receipt port: the stored handoff receipts of the SG4b ledger (host-ledger.ts), read by job key. */
export function createHostBuildReceipts(pool: pg.Pool): Pick<HostLedger, "find"> {
  return {
    async find(jobKeyValue: string): Promise<HandoffReceipt | undefined> {
      const row = (await pool.query<{ receipt: HandoffReceipt }>(
        "SELECT receipt FROM artifacts.host_build_receipts WHERE job_key = $1", [jobKeyValue])).rows[0];
      return row?.receipt;
    },
  };
}

export interface PendingBuildReconciler {
  readonly options: ReconcileOptions;
  /** Threshold sweep (`reconcilePendingBuilds` with the package defaults unless overridden). */
  sweep(): Promise<ReconcileReport>;
  /** On-demand reconcile of one job, for the host read paths. */
  reconcileJob(key: { scopeId: string; artifactId: string; jobId: string }): Promise<ReconcileItemResult>;
  /** On-demand reconcile of the artifact's latest pending job, if any. */
  reconcileArtifact(artifactId: string): Promise<ReconcileItemResult | undefined>;
}

export function createPendingBuildReconciler(input: {
  readonly jobs: ReturnType<typeof createPostgresReconcileJobStore>;
  readonly status: ReconcileStatusClient;
  readonly bindings: Pick<GitBindingStore, "get" | "write">;
  readonly receipts?: Pick<HostLedger, "find"> | undefined;
  readonly now?: () => number;
  readonly olderThanMs?: number;
  readonly limit?: number;
  readonly concurrency?: number;
  readonly onItem?: (item: ReconcileItemResult) => void;
}): PendingBuildReconciler {
  const options: ReconcileOptions = { jobs: input.jobs, status: input.status, bindings: input.bindings,
    ...(input.receipts ? { receipts: input.receipts } : {}),
    ...(input.now ? { now: input.now } : {}),
    ...(input.olderThanMs !== undefined ? { olderThanMs: input.olderThanMs } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}) };
  const reconciler: PendingBuildReconciler = {
    options,
    async sweep() {
      const report = await reconcilePendingBuilds(options);
      for (const item of report.items) input.onItem?.(item);
      return report;
    },
    async reconcileJob(key) {
      const item = await reconcilePendingBuild(options, key);
      input.onItem?.(item);
      return item;
    },
    async reconcileArtifact(artifactId) {
      const pending = await input.jobs.pendingForArtifact(artifactId);
      return pending ? reconciler.reconcileJob(pending) : undefined;
    },
  };
  return reconciler;
}
