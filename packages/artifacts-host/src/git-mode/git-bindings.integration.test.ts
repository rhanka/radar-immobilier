import { randomUUID } from "node:crypto";
import { createPostgresGitBindingStore } from "@sentropic/artifacts/adapters/postgres";
import type { GitBinding } from "@sentropic/artifacts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { p0bFixture } from "../p0b.test-support.js";

/**
 * 0036_artifacts_git_bindings (provider 0010 plus the lock-timeout prefix and the
 * replay-idempotence rewrite, see artifacts-provenance.spec.ts) on the immo
 * artifacts schema: the provider binding store writes a binding, its audit
 * event and its replay receipt in one transaction, and the audit stays
 * append-only. 0040_artifacts_git_attach_intents (provider 0012, 0.2.20): the
 * durable attach intent and the `branchCreated` audit marker.
 */
describe.skipIf(!process.env.P0B_DATABASE_URL)("git bindings on the immo schema (0036, 0040)", () => {
  let fixture: Awaited<ReturnType<typeof p0bFixture>>;
  beforeAll(async () => { fixture = await p0bFixture(); });
  afterAll(async () => { await fixture?.close(); });

  it("attaches a personal binding, replays it and refuses an audit mutation", async () => {
    const { artifactId } = await fixture.page();
    const store = createPostgresGitBindingStore(fixture.pool);
    const now = new Date().toISOString();
    const binding: GitBinding = { artifactId, storageScopeId: "p0b", repoId: "radar-immobilier",
      branch: `artifact/p/alice000/triage-${artifactId.slice(0, 8)}`, channel: "personal", personalPrincipalId: "alice",
      subPath: "", baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40), releaseCommitSha: null, autoPublish: true,
      executor: "sandbox", pendingJobId: null, pendingCommitSha: null, state: "attached", generation: 1, version: 1,
      attachedBy: "alice", attachedAt: now, updatedAt: now };
    const write = { binding, expectedVersion: null, actorId: "alice", idempotencyKey: randomUUID(), commandHash: "h1",
      event: { action: "attach" as const } };
    const first = await store.write(write);
    expect(first.replayed).toBe(false);
    expect((await store.write(write)).replayed).toBe(true);
    expect(await store.get("p0b", artifactId)).toMatchObject({ branch: binding.branch, state: "attached" });
    expect((await store.events("p0b", artifactId)).map((event) => event.action)).toEqual(["attach"]);
    await expect(fixture.pool.query("UPDATE artifacts.git_binding_events SET actor_id = 'x'"))
      .rejects.toThrow(/append-only/);
  });

  it("reserves an attach intent put-if-absent and records branchCreated on the attach event (0040)", async () => {
    const { artifactId } = await fixture.page();
    const store = createPostgresGitBindingStore(fixture.pool);
    const now = new Date().toISOString();
    const branch = `artifact/p/alice000/triage-${artifactId.slice(0, 8)}`;
    const key = randomUUID();
    const intent = { storageScopeId: "p0b", artifactId, actorId: "alice", idempotencyKey: key, commandHash: "h1",
      repoId: "radar-immobilier", branch, baseCommitSha: "a".repeat(40), createdAt: now };
    expect(await store.reserveAttachIntent(intent)).toEqual(intent);
    expect(await store.reserveAttachIntent({ ...intent, commandHash: "h2", baseCommitSha: "b".repeat(40) })).toEqual(intent);
    expect(await store.attachIntent("p0b", "alice", key)).toEqual(intent);
    expect(await store.attachIntent("p0b", "bob", key)).toBeUndefined();
    await expect(store.reserveAttachIntent({ ...intent, idempotencyKey: randomUUID(), branch: "main" }))
      .rejects.toMatchObject({ kind: "invalid_request" });
    const binding: GitBinding = { artifactId, storageScopeId: "p0b", repoId: "radar-immobilier", branch, channel: "personal",
      personalPrincipalId: "alice", subPath: "", baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40),
      releaseCommitSha: null, autoPublish: true, executor: "sandbox", pendingJobId: null, pendingCommitSha: null,
      state: "attached", generation: 1, version: 1, attachedBy: "alice", attachedAt: now, updatedAt: now };
    await store.write({ binding, expectedVersion: null, actorId: "alice", idempotencyKey: key, commandHash: "h1",
      event: { action: "attach", branchCreated: true } });
    expect(await store.events("p0b", artifactId)).toEqual([expect.objectContaining({ action: "attach", branchCreated: true })]);
    await expect(fixture.pool.query(`INSERT INTO artifacts.git_binding_events (artifact_id, storage_scope_id, actor_id, action,
      created_at, branch_created) VALUES ($1, 'p0b', 'alice', 'pause', now(), true)`, [artifactId]))
      .rejects.toThrow(/git_binding_events_branch_created/);
  });
});
