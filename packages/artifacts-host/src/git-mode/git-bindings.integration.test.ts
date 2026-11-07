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
 * append-only.
 */
describe.skipIf(!process.env.P0B_DATABASE_URL)("git bindings on the immo schema (0036)", () => {
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
});
