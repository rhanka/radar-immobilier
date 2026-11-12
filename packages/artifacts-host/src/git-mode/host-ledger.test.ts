import type { HostRecheckView } from "@sentropic/artifacts/live-host";
import { describe, expect, it, vi } from "vitest";
import { createPostgresHostJobStore } from "./host-jobs.js";
import { createPostgresHostBuildLedger, normalizeBuilderImageAllowlist, normalizeBuilderImageDigest } from "./host-ledger.js";

const HEX = "add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68";
const DIGEST = `sha256:${HEX}`;

describe("builder image allowlist normalisation", () => {
  it("accepts a bare digest and a full reference, both as the bare digest", () => {
    expect(normalizeBuilderImageDigest(DIGEST)).toBe(DIGEST);
    expect(normalizeBuilderImageDigest(`docker.io/library/node@${DIGEST}`)).toBe(DIGEST);
    expect(normalizeBuilderImageAllowlist([DIGEST])).toEqual([DIGEST]);
    expect(normalizeBuilderImageAllowlist([`docker.io/library/node@${DIGEST}`])).toEqual([DIGEST]);
  });

  it("refuses anything that is neither a bare digest nor a full reference", () => {
    for (const entry of ["docker.io/library/node:latest", "node", "sha256:xyz", `sha256:${HEX.slice(0, 63)}`,
      `${DIGEST}ff`, `@${DIGEST}`, `docker.io/library/node@sha256:${HEX.slice(0, 10)}`, ""]) {
      expect(normalizeBuilderImageDigest(entry)).toBeUndefined();
    }
    expect(normalizeBuilderImageAllowlist(["docker.io/library/node:latest", "latest"])).toEqual([]);
  });

  it("trims, lowercases and deduplicates entries", () => {
    expect(normalizeBuilderImageAllowlist([`  docker.io/library/node@${DIGEST} `, DIGEST.toUpperCase().replace("SHA256:", "sha256:")]))
      .toEqual([DIGEST]);
  });
});

describe("host recheck view owner (0.2.27 ownerId, fake pool)", () => {
  const ARTIFACT = "11111111-1111-4111-8111-111111111111";
  const binding = { artifact_id: ARTIFACT, repo_id: "radar-immobilier", branch: "artifact/p/alice000/x", sub_path: "",
    state: "build_pending", generation: 1, executor: "sandbox", auto_publish: true, pending_job_id: "job-1",
    pending_commit_sha: "a".repeat(40), release_commit_sha: null, version: 2 };
  async function ownerSeen(row: Record<string, unknown>): Promise<string> {
    const client = { release: () => {}, query: vi.fn(async (sql: string) => ({
      rows: /git_bindings/.test(sql) ? [row] : /host_build_jobs/.test(sql) ? [{ job_id: "job-1", state: "build_pending",
        binding_generation: 1, commit_sha: "a".repeat(40), expected_current_release_id: null, requested_by: "alice",
        fence_run_id: null, fence_attempt: null }] : [] })) };
    const ledger = createPostgresHostBuildLedger({ pool: { connect: async () => client } as never, scopeId: "s",
      blobs: {} as never, candidateDigest: () => "d", headReachable: async () => true, ownerAuthorized: async () => true,
      imageAllowlist: [], killSwitch: () => false, refuse: (code) => new Error(code) });
    let view: HostRecheckView | undefined;
    await ledger.admitJob(ARTIFACT, "job-1", (current) => { view = current; return null; });
    return view!.binding.ownerId;
  }

  it("sends the personal owner, and falls back on attached_by for a binding without one", async () => {
    expect(await ownerSeen({ ...binding, personal_principal_id: "alice", attached_by: "bob" })).toBe("alice");
    expect(await ownerSeen({ ...binding, personal_principal_id: null, attached_by: "bob" })).toBe("bob");
  });
});

describe("Postgres host job store: request-time refusal (fake pool)", () => {
  const job = { storageScopeId: "s", artifactId: "11111111-1111-4111-8111-111111111111", repoId: "radar-immobilier",
    branch: "artifact/p/alice000/x", subPath: "", commitSha: "a".repeat(40), bindingGeneration: 1, expectedCurrentReleaseId: null,
    executor: "sandbox" as const, requestedBy: "alice", idempotencyKey: "k" };

  it("closes only a pending job as build_failed with the refusal code and reason", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await createPostgresHostJobStore({ pool: { query } as never, scopeId: "s", now: () => 0 })
      .refuse("job-1", { code: "host_refused_live_session", reason: "active_session" });
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/SET state = 'build_failed', code = \$3, reason = \$4/);
    expect(sql).toMatch(/AND state = 'build_pending'/);
    expect(values.slice(0, 4)).toEqual(["s", "job-1", "host_refused_live_session", "active_session"]);
  });

  it("re-arms the same job when the refused command is retried", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.trim().startsWith("SELECT")
      ? [{ job_id: "job-1", artifact_id: job.artifactId, commit_sha: job.commitSha, binding_generation: 1 }] : [] }));
    await expect(createPostgresHostJobStore({ pool: { query } as never, scopeId: "s", now: () => 0 }).persist(job))
      .resolves.toBe("job-1");
    const [sql, values] = query.mock.calls[2] as unknown as [string, unknown[]];
    expect(sql).toMatch(/SET state = 'build_pending', code = NULL, reason = NULL/);
    expect(sql).toMatch(/state = 'build_failed' AND code = \$4/);
    expect(values).toEqual(["s", "job-1", new Date(0).toISOString(), "host_refused_live_session"]);
  });
});
