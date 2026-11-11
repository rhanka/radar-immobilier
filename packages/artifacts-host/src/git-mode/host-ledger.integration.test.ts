import { createHash, randomUUID } from "node:crypto";
import { candidateDigest, LiveHostError } from "@sentropic/artifacts/live-host";
import { createPostgresGitBindingStore } from "@sentropic/artifacts/adapters/postgres";
import type { GitBinding } from "@sentropic/artifacts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { p0bFixture } from "../p0b.test-support.js";
import { createPostgresHostJobStore } from "./host-jobs.js";
import {
  createPostgresHostBuildLedger, type CandidateFile, type HandoffClaims, type HandoffReceipt, type HostRecheckView,
} from "./host-ledger.js";

/**
 * 0039_artifacts_host_build_ledger on the immo schema: job persistence and
 * attempt fence, then ONE Postgres transaction that writes the release, its
 * blob references, the current pointer, the git release index, the binding
 * baseline, the job state and the receipt; a replay returns the stored
 * receipt; a refusal rolls every Postgres row back.
 *
 * Atomicity covers Postgres only: the candidate blobs are written to the
 * object store during the transaction and are NOT removed on rollback. They
 * stay digest-addressed orphans with no release reference, reclaimed by the
 * same orphan sweep as the provider's own publications.
 */
/** Provider live-host code (0.2.20): the stored bytes are digested and refused exactly like a real handoff. */
const digestOf = candidateDigest;
const IMAGE = "docker.io/library/node@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68";
const SHA = "c".repeat(40);

describe.skipIf(!process.env.P0B_DATABASE_URL)("SG4b host build ledger on the immo schema (0039)", () => {
  let fixture: Awaited<ReturnType<typeof p0bFixture>>;
  beforeAll(async () => { fixture = await p0bFixture(); });
  afterAll(async () => { await fixture?.close(); });

  async function pendingJob() {
    const { artifactId, releaseId: currentReleaseId } = await fixture.page();
    const now = new Date().toISOString();
    const bindings = createPostgresGitBindingStore(fixture.pool);
    const attached: GitBinding = { artifactId, storageScopeId: "p0b", repoId: "radar-immobilier",
      branch: `artifact/p/alice000/triage-${artifactId.slice(0, 8)}`, channel: "personal", personalPrincipalId: "alice",
      subPath: "", baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40), releaseCommitSha: null, autoPublish: true,
      executor: "sandbox", pendingJobId: null, pendingCommitSha: null, state: "attached", generation: 1, version: 1,
      attachedBy: "alice", attachedAt: now, updatedAt: now };
    await bindings.write({ binding: attached, expectedVersion: null, actorId: "alice", idempotencyKey: randomUUID(),
      commandHash: "h1", event: { action: "attach" } });
    const jobs = createPostgresHostJobStore({ pool: fixture.pool, scopeId: "p0b" });
    const request = { storageScopeId: "p0b", artifactId, repoId: "radar-immobilier", branch: attached.branch, subPath: "",
      commitSha: SHA, bindingGeneration: 1, expectedCurrentReleaseId: currentReleaseId, executor: "sandbox" as const,
      requestedBy: "alice", idempotencyKey: randomUUID() };
    const jobId = await jobs.persist(request);
    expect(await jobs.persist(request)).toBe(jobId);
    await expect(jobs.persist({ ...request, commitSha: "d".repeat(40) })).rejects.toMatchObject({ kind: "command_conflict" });
    await bindings.write({ binding: { ...attached, state: "build_pending", headCommitSha: SHA, pendingJobId: jobId,
      pendingCommitSha: SHA, version: 2 }, expectedVersion: 1, actorId: "alice", idempotencyKey: randomUUID(), commandHash: "h2",
    event: { action: "publish", afterSha: SHA } });
    return { artifactId, jobId, currentReleaseId };
  }

  function ledgerWith(overrides: { imageAllowlist?: string[] } = {}) {
    return createPostgresHostBuildLedger({ pool: fixture.pool, scopeId: "p0b", blobs: fixture.blobs, candidateDigest: digestOf,
      headReachable: async () => true, ownerAuthorized: async (principal) => principal === "alice",
      imageAllowlist: overrides.imageAllowlist ?? [IMAGE], killSwitch: () => false,
      refuse: (code, reason) => new LiveHostError(code, reason) });
  }
  const claimsFor = (artifactId: string, jobId: string, expectedReleaseId: string | null, files: CandidateFile[]): HandoffClaims => ({
    v: 1, kid: "sentropic-builder-1", scopeId: "p0b", artifactId, jobId, kind: "explicit", runId: "run-1", attempt: 1, generation: 1,
    commitSha: SHA, treeSha: "e".repeat(40), tuple: { commitSha: SHA, treeSha: "e".repeat(40), lockfileDigest: "l", descriptorDigest: "d",
      builderImageDigest: IMAGE, nodeVersion: "22", npmVersion: "10", publicEnvHashes: {} }, candidateDigest: digestOf(files),
    expectedReleaseId, nonce: randomUUID(), sealedAt: Date.now(), expiresAt: Date.now() + 600_000 });
  const files: CandidateFile[] = [
    { path: "index.html", bytes: new TextEncoder().encode("<!doctype html><title>triage</title>") },
    { path: "assets/app.js", bytes: new TextEncoder().encode("console.log('triage')") },
  ];

  it("admits the pending job with a monotonic fence, then publishes everything in one transaction and replays the receipt", async () => {
    const { artifactId, jobId, currentReleaseId } = await pendingJob();
    const ledger = ledgerWith();
    let seen: HostRecheckView | undefined;
    const admitted = await ledger.admitJob(artifactId, jobId, (view) => {
      seen = view;
      return view.job && view.binding.pendingJobId === jobId
        ? { job: { jobId, generation: 1, headSha: SHA, expectedReleaseId: currentReleaseId, ownerId: "alice" }, fence: { runId: "run-1", attempt: 1 } } : null;
    });
    expect(admitted).toEqual({ jobId, generation: 1, headSha: SHA, expectedReleaseId: currentReleaseId, ownerId: "alice" });
    expect(seen?.binding).toMatchObject({ state: "build_pending", pendingJobId: jobId, executor: "sandbox", ownerId: "alice" });
    const job = (await fixture.pool.query("SELECT state, fence_run_id, fence_attempt FROM artifacts.host_build_jobs WHERE job_id = $1", [jobId])).rows[0];
    expect(job).toEqual({ state: "building", fence_run_id: "run-1", fence_attempt: 1 });

    const claims = claimsFor(artifactId, jobId, currentReleaseId, files);
    const jobKey = `job-${jobId}`;
    const work = async (): Promise<HandoffReceipt> => {
      const view = await ledger.view(claims);
      expect(view).toMatchObject({ scopeId: "p0b", headReachable: true, currentReleaseId, imageAllowlist: [IMAGE],
        policy: { ownerAuthorized: true }, job: { jobId, state: "building", fence: { runId: "run-1", attempt: 1 } } });
      const published = await ledger.publish(claims, files);
      expect(published.storedDigest).toBe(claims.candidateDigest);
      return { v: 1, kid: "immo-preprod-receipt-1", nonce: claims.nonce, scopeId: "p0b", artifactId, jobId, runId: "run-1", attempt: 1,
        commitSha: SHA, candidateDigest: claims.candidateDigest, releaseId: published.releaseId, manifestDigest: published.manifestDigest,
        committedAt: Date.now(), signature: "sig" };
    };
    const receipt = await ledger.ledger.transaction(jobKey, work);
    const db = fixture.pool;
    expect((await db.query("SELECT release_id FROM artifacts.artifact_current WHERE artifact_id = $1", [artifactId])).rows[0].release_id)
      .toBe(receipt.releaseId);
    expect((await db.query("SELECT git_commit, parent_release_id FROM artifacts.releases WHERE id = $1", [receipt.releaseId])).rows[0])
      .toEqual({ git_commit: SHA, parent_release_id: currentReleaseId });
    expect((await db.query("SELECT executor, verification, job_id, build_run_id, attempt FROM artifacts.git_release_index WHERE release_id = $1",
      [receipt.releaseId])).rows[0]).toEqual({ executor: "sandbox", verification: "builder-attested", job_id: jobId, build_run_id: "run-1", attempt: 1 });
    expect((await db.query("SELECT state, release_commit_sha, pending_job_id FROM artifacts.git_bindings WHERE artifact_id = $1",
      [artifactId])).rows[0]).toEqual({ state: "attached", release_commit_sha: SHA, pending_job_id: null });
    expect((await db.query("SELECT state FROM artifacts.host_build_jobs WHERE job_id = $1", [jobId])).rows[0].state).toBe("published");
    expect((await db.query("SELECT count(*)::int AS n FROM artifacts.blob_ref_holders WHERE holder = $1", [receipt.releaseId])).rows[0].n).toBe(2);
    expect(await ledger.ledger.find(jobKey)).toEqual(receipt);

    // Replay: the stored receipt comes back, nothing is written twice.
    const releases = (await db.query("SELECT count(*)::int AS n FROM artifacts.releases WHERE artifact_id = $1", [artifactId])).rows[0].n;
    expect(await ledger.ledger.transaction(jobKey, async () => { throw new Error("must not run"); })).toEqual(receipt);
    expect((await db.query("SELECT count(*)::int AS n FROM artifacts.releases WHERE artifact_id = $1", [artifactId])).rows[0].n).toBe(releases);
  });

  it("refuses an older attempt fence for an admitted job", async () => {
    const { artifactId, jobId } = await pendingJob();
    const ledger = ledgerWith();
    const decide = (attempt: number) => (view: HostRecheckView) =>
      view.job && (!view.job.fence || attempt >= view.job.fence.attempt)
        ? { job: { jobId, generation: 1, headSha: SHA, expectedReleaseId: null, ownerId: "alice" }, fence: { runId: `run-${attempt}`, attempt } } : null;
    expect(await ledger.admitJob(artifactId, jobId, decide(2))).not.toBeNull();
    expect(await ledger.admitJob(artifactId, jobId, decide(1))).toBeNull();
    expect((await fixture.pool.query("SELECT fence_attempt FROM artifacts.host_build_jobs WHERE job_id = $1", [jobId])).rows[0].fence_attempt).toBe(2);
  });

  it("rolls every Postgres row back on a release conflict, with a typed live-host refusal (blobs stay orphaned)", async () => {
    const { artifactId, jobId, currentReleaseId } = await pendingJob();
    const ledger = ledgerWith();
    await ledger.admitJob(artifactId, jobId, () => ({ job: { jobId, generation: 1, headSha: SHA, expectedReleaseId: currentReleaseId, ownerId: "alice" },
      fence: { runId: "run-1", attempt: 1 } }));
    const claims = claimsFor(artifactId, jobId, randomUUID(), files);
    const before = (await fixture.pool.query("SELECT count(*)::int AS n FROM artifacts.releases WHERE artifact_id = $1", [artifactId])).rows[0].n;
    const failure = await ledger.ledger.transaction(`job-${jobId}`, async () => {
      await ledger.publish(claims, files);
      throw new Error("unreachable");
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LiveHostError);
    expect(failure).toMatchObject({ code: "handoff_mismatch", reason: "release_conflict" });
    expect((await fixture.pool.query("SELECT count(*)::int AS n FROM artifacts.releases WHERE artifact_id = $1", [artifactId])).rows[0].n).toBe(before);
    expect(await ledger.ledger.find(`job-${jobId}`)).toBeUndefined();
    expect((await fixture.pool.query("SELECT state FROM artifacts.git_bindings WHERE artifact_id = $1", [artifactId])).rows[0].state).toBe("build_pending");
    // Object store writes are outside the Postgres transaction: the bytes remain as unreferenced digest-addressed blobs.
    const key = `artifacts/p0b/blobs/sha256/${createHash("sha256").update(files[0]!.bytes).digest("hex")}`;
    expect(await fixture.blobs.getBlob(key)).toBeDefined();
  });

  it("refuses publication outside a ledger transaction", async () => {
    await expect(ledgerWith().publish(claimsFor(randomUUID(), randomUUID(), null, files), files)).rejects.toThrow("host_ledger_outside_transaction");
  });
});
