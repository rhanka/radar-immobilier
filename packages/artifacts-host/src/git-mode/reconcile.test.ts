import { createMemoryGitBindingStore, type GitBinding } from "@sentropic/artifacts";
import { reconcilePendingBuilds } from "@sentropic/artifacts/live-host";
import { describe, expect, it, vi } from "vitest";
import type { HostBuildStatus } from "./build-api.js";
import {
  createPendingBuildReconciler, createPostgresReconcileJobStore, createReconcileStatusClient,
} from "./reconcile.js";
import { createPostgresHostJobStore } from "./host-jobs.js";
import type { GitBuildJobRequest } from "./provider-adapter.js";

/**
 * P1 regression (jobs stuck at `building` / `build_pending` after a builder
 * failure): the package sweep must close the host job and the binding, once,
 * and a later git_publish must be able to persist a fresh job.
 */
const SCOPE = "s";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const SHA = "b".repeat(40);
const NOW = Date.parse("2026-11-08T00:00:00.000Z");

interface JobRow {
  job_id: string; artifact_id: string; state: string; code: string | null; reason: string | null;
  updated_at: Date; commit_sha: string; binding_generation: number;
}

/** Minimal in-memory emulation of the artifacts.host_build_jobs statements used by the ports. */
function fakePool(rows: JobRow[]) {
  const query = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    if (sql.includes("INSERT INTO artifacts.host_build_jobs")) {
      const [jobId, , artifactId, , , , commitSha, generation] = params as [string, string, string, string, string, string, string, number];
      if (rows.some((row) => row.job_id === jobId)) return { rows: [], rowCount: 0 };
      rows.push({ job_id: jobId, artifact_id: artifactId, state: "build_pending", code: null, reason: null,
        updated_at: new Date(NOW), commit_sha: commitSha, binding_generation: generation });
      return { rows: [{ job_id: jobId }], rowCount: 1 };
    }
    if (sql.includes("UPDATE artifacts.host_build_jobs SET state = 'build_failed'")) {
      const row = rows.find((r) => r.artifact_id === params[1] && r.job_id === params[2]
        && (r.state === "build_pending" || r.state === "building"));
      if (!row) return { rows: [], rowCount: 0 };
      row.state = "build_failed"; row.code = params[3] as string; row.reason = params[4] as string;
      row.updated_at = params[5] as Date;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE artifacts.host_build_jobs SET state = 'published'")) {
      const row = rows.find((r) => r.artifact_id === params[1] && r.job_id === params[2]
        && (r.state === "build_pending" || r.state === "building"));
      if (!row) return { rows: [], rowCount: 0 };
      row.state = "published"; row.updated_at = params[3] as Date;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM artifacts.host_build_jobs") && sql.includes("updated_at <")) {
      const cutoff = (params[1] as Date).getTime();
      const found = rows.filter((r) => (r.state === "build_pending" || r.state === "building")
        && r.updated_at.getTime() < cutoff).slice(0, params[2] as number);
      return { rows: found.map((r) => ({ job_id: r.job_id, artifact_id: r.artifact_id, updated_at: r.updated_at })), rowCount: found.length };
    }
    if (sql.includes("FROM artifacts.host_build_jobs") && sql.includes("state IN")) {
      const found = rows.filter((r) => r.artifact_id === params[1]
        && (r.state === "build_pending" || r.state === "building"))
        .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
      return { rows: found.slice(0, 1).map((r) => ({ job_id: r.job_id })), rowCount: Math.min(found.length, 1) };
    }
    if (sql.includes("SELECT state FROM artifacts.host_build_jobs")) {
      const row = rows.find((r) => r.artifact_id === params[1] && r.job_id === params[2]);
      return { rows: row ? [{ state: row.state }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("SELECT * FROM artifacts.host_build_jobs")) {
      const row = rows.find((r) => r.job_id === (params as string[])[2]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  return { query } as unknown as Parameters<typeof createPostgresReconcileJobStore>[0]["pool"];
}

function binding(state: GitBinding["state"] = "build_pending"): GitBinding {
  return { artifactId: ARTIFACT, storageScopeId: SCOPE, repoId: "radar-immobilier",
    branch: "artifact/p/alice000/triage-11111111", channel: "personal", personalPrincipalId: "alice", subPath: "",
    baseCommitSha: "a".repeat(40), headCommitSha: SHA, releaseCommitSha: null, autoPublish: true, executor: "sandbox",
    pendingJobId: JOB, pendingCommitSha: SHA, state, generation: 2, version: 3, attachedBy: "alice",
    attachedAt: "2026-11-07T00:00:00.000Z", updatedAt: "2026-11-07T00:00:00.000Z" };
}

function setup(status: () => Promise<HostBuildStatus | undefined>) {
  const rows: JobRow[] = [{ job_id: JOB, artifact_id: ARTIFACT, state: "building", code: null, reason: null,
    updated_at: new Date(NOW - 20 * 60_000), commit_sha: SHA, binding_generation: 2 }];
  const pool = fakePool(rows);
  const jobs = createPostgresReconcileJobStore({ pool, scopeId: SCOPE });
  const bindings = createMemoryGitBindingStore();
  return { rows, pool, jobs, bindings, status, seed: async () => {
    await bindings.write({ binding: { ...binding(), generation: 1, version: 1, state: "attached", pendingJobId: null, pendingCommitSha: null },
      expectedVersion: null, actorId: "alice", idempotencyKey: "seed-1", commandHash: "seed-1",
      event: { action: "attach" } });
    await bindings.write({ binding: { ...binding(), generation: 1, version: 2 }, expectedVersion: 1, actorId: "alice",
      idempotencyKey: "seed-2", commandHash: "seed-2", event: { action: "publish" } });
  } };
}

describe("reconcile pending builds (host ports)", () => {
  it("answers undefined on a builder 404 and propagates transport failures", async () => {
    const missing = createReconcileStatusClient({ status: async () => undefined });
    await expect(missing.status({ scopeId: SCOPE, artifactId: ARTIFACT, jobId: JOB })).resolves.toBeUndefined();
    const down = createReconcileStatusClient({ status: async () => { throw new Error("transport"); } });
    await expect(down.status({ scopeId: SCOPE, artifactId: ARTIFACT, jobId: JOB })).rejects.toThrow("transport");
  });

  it("moves the host job and the binding to build_failed on a builder failure, idempotently", async () => {
    const failed: HostBuildStatus = { jobId: JOB, state: "build_failed", code: "build_error", reason: "npm run build failed" };
    const { rows, jobs, bindings, seed } = setup(async () => failed);
    await seed();
    const options = { jobs, status: createReconcileStatusClient({ status: async () => failed }), bindings,
      now: () => NOW, olderThanMs: 10 * 60_000 };
    const first = await reconcilePendingBuilds(options);
    expect(first.items).toEqual([expect.objectContaining({ jobId: JOB, outcome: "job-build-failed", job: "updated", binding: "updated" })]);
    expect(rows[0]).toMatchObject({ state: "build_failed", code: "build_error", reason: "npm run build failed" });
    expect(await bindings.get(SCOPE, ARTIFACT)).toMatchObject({ state: "build_failed", stateDetail: "build_error" });
    const second = await reconcilePendingBuilds(options);
    expect(second).toMatchObject({ checked: 0, updated: 0, items: [] });
    const again = await createPendingBuildReconciler({ jobs, status: createReconcileStatusClient({ status: async () => failed }),
      bindings, now: () => NOW }).reconcileArtifact(ARTIFACT);
    expect(again).toBeUndefined();
    expect(rows).toHaveLength(1);
  });

  it("lets the next git_publish persist a new job after the failure", async () => {
    const failed: HostBuildStatus = { jobId: JOB, state: "build_failed", code: "build_error", reason: "boom" };
    const { rows, pool, jobs, bindings, seed } = setup(async () => failed);
    await seed();
    await reconcilePendingBuilds({ jobs, status: createReconcileStatusClient({ status: async () => failed }),
      bindings, now: () => NOW, olderThanMs: 10 * 60_000 });
    const store = createPostgresHostJobStore({ pool, scopeId: SCOPE, now: () => NOW });
    const request: GitBuildJobRequest = { storageScopeId: SCOPE, artifactId: ARTIFACT, repoId: "radar-immobilier",
      branch: "artifact/p/alice000/triage-11111111", subPath: "", commitSha: SHA, bindingGeneration: 2,
      expectedCurrentReleaseId: null, executor: "sandbox", requestedBy: "alice", idempotencyKey: "publish-2" };
    const next = await store.persist(request);
    expect(next).not.toBe(JOB);
    expect(rows.find((row) => row.job_id === next)).toMatchObject({ state: "build_pending" });
  });
});
