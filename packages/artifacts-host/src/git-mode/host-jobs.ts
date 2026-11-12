import { randomUUID } from "node:crypto";
import type pg from "pg";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { HOST_LIVE_SESSION_REFUSAL, type HostBuildJobStore } from "./build-api.js";
import type { GitBuildJobRequest } from "./provider-adapter.js";

interface JobRow { job_id: string; artifact_id: string; commit_sha: string; binding_generation: string | number }

/** Job persistence used by the builder client before `POST /v1/builds` (idempotent per requester key). */
export function createPostgresHostJobStore(options: { readonly pool: pg.Pool; readonly scopeId: string; readonly now?: () => number }):
HostBuildJobStore {
  const { pool, scopeId } = options;
  const now = options.now ?? Date.now;
  return {
    async persist(job: GitBuildJobRequest) {
      if (job.storageScopeId !== scopeId || job.executor !== "sandbox") throw new ArtifactOperationError("invalid_request");
      const at = new Date(now()).toISOString();
      const inserted = await pool.query<{ job_id: string }>(`INSERT INTO artifacts.host_build_jobs (job_id, storage_scope_id,
        artifact_id, repo_id, branch, sub_path, commit_sha, binding_generation, expected_current_release_id, executor, requested_by,
        idempotency_key, state, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'build_pending',$13,$13)
        ON CONFLICT (storage_scope_id, requested_by, idempotency_key) DO NOTHING RETURNING job_id`,
      [randomUUID(), scopeId, job.artifactId, job.repoId, job.branch, job.subPath, job.commitSha, job.bindingGeneration,
        job.expectedCurrentReleaseId, job.executor, job.requestedBy, job.idempotencyKey, at]);
      if (inserted.rows[0]) return inserted.rows[0].job_id;
      const existing = (await pool.query<JobRow>(`SELECT * FROM artifacts.host_build_jobs
        WHERE storage_scope_id = $1 AND requested_by = $2 AND idempotency_key = $3`, [scopeId, job.requestedBy, job.idempotencyKey])).rows[0];
      if (!existing || existing.artifact_id !== job.artifactId || existing.commit_sha !== job.commitSha ||
        Number(existing.binding_generation) !== job.bindingGeneration) throw new ArtifactOperationError("command_conflict");
      // A job refused at request time never reached a build: the retry of the same command re-arms it.
      await pool.query(`UPDATE artifacts.host_build_jobs SET state = 'build_pending', code = NULL, reason = NULL, updated_at = $3
        WHERE storage_scope_id = $1 AND job_id = $2 AND state = 'build_failed' AND code = $4`,
      [scopeId, existing.job_id, at, HOST_LIVE_SESSION_REFUSAL.code]);
      return existing.job_id;
    },
    async refuse(jobId, refusal) {
      await pool.query(`UPDATE artifacts.host_build_jobs SET state = 'build_failed', code = $3, reason = $4, updated_at = $5
        WHERE storage_scope_id = $1 AND job_id = $2 AND state = 'build_pending'`,
      [scopeId, jobId, refusal.code, refusal.reason, new Date(now()).toISOString()]);
    },
  };
}

