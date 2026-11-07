import { createPostgresGitBindingStore } from "@sentropic/artifacts/adapters/postgres";
import type { GitBinding } from "@sentropic/artifacts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { p0bFixture } from "../p0b.test-support.js";
import { createLiveInvitationService, createPostgresLiveInvitationStore, createPostgresLiveSessions } from "./live-authority.js";
import { createImmoGitRegistry } from "./registry.js";

/**
 * 0037 (provider 0011 byte copy) and 0038 (immo invitation ledger) on the
 * immo schema: the live session is read from the provider draft record and
 * an invitation is created, listed and revoked durably (epoch bump).
 */
describe.skipIf(!process.env.P0B_DATABASE_URL)("live invitations on the immo schema (0037, 0038)", () => {
  let fixture: Awaited<ReturnType<typeof p0bFixture>>;
  beforeAll(async () => { fixture = await p0bFixture(); });
  afterAll(async () => { await fixture?.close(); });

  it("creates, lists and revokes an invitation bound to the live session and generation", async () => {
    const { artifactId } = await fixture.page();
    const now = new Date().toISOString();
    const binding: GitBinding = { artifactId, storageScopeId: "p0b", repoId: "radar-immobilier",
      branch: `artifact/p/alice000/triage-${artifactId.slice(0, 8)}`, channel: "personal", personalPrincipalId: "alice",
      subPath: "", baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40), releaseCommitSha: null, autoPublish: true,
      executor: "sandbox", pendingJobId: null, pendingCommitSha: null, state: "attached", generation: 1, version: 1,
      attachedBy: "alice", attachedAt: now, updatedAt: now };
    const bindings = createPostgresGitBindingStore(fixture.pool);
    await bindings.write({ binding, expectedVersion: null, actorId: "alice", idempotencyKey: `attach-${artifactId}`,
      commandHash: "h", event: { action: "attach" } });
    const sessions = createPostgresLiveSessions(fixture.pool);
    expect(await sessions.current(binding)).toBeUndefined();
    await fixture.pool.query(`INSERT INTO artifacts.live_drafts (storage_scope_id, artifact_id, binding_generation, record)
      VALUES ('p0b', $1, 1, $2)`, [artifactId, JSON.stringify({ runtime: { liveSessionId: "session-1", phase: "LIVE" } })]);
    expect(await sessions.current(binding)).toEqual({ liveSessionId: "session-1" });
    const service = createLiveInvitationService({ bindings, sessions, invitations: createPostgresLiveInvitationStore(fixture.pool),
      registry: createImmoGitRegistry({ storageScopeId: "p0b", installationRef: "inst" }),
      codeRights: { canReadCode: async ({ actorId }) => ["alice", "idp-bob"].includes(actorId) } });
    const caller = { actorId: "alice", storageScopeId: "p0b", scopes: ["immo:artifacts:read", "immo:artifacts:write"] };
    const created = await service.create(caller, { artifactId, inviteeId: "idp-bob" });
    expect(created).toMatchObject({ liveSessionId: "session-1", bindingGeneration: 1, epoch: 1 });
    expect((await service.list(caller, { artifactId })).map((row) => row.active)).toEqual([true]);
    const revoked = await service.revoke(caller, { artifactId, invitationId: created.invitationId });
    expect(revoked).toMatchObject({ epoch: 2 });
    expect((await service.revoke(caller, { artifactId, invitationId: created.invitationId })).epoch).toBe(2);
    expect((await service.list(caller, { artifactId })).map((row) => row.active)).toEqual([false]);
  });
});
