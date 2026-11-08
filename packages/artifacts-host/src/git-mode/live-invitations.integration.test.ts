import { createPostgresGitBindingStore } from "@sentropic/artifacts/adapters/postgres";
import type { GitBinding } from "@sentropic/artifacts";
import * as liveHost from "@sentropic/artifacts/live-host";
import { verifyLiveControl } from "@sentropic/artifacts/live-host";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LiveControlTransport } from "./live-edge.js";
import { composeLiveEdgePorts } from "./live-forward.js";
import { p0bFixture } from "../p0b.test-support.js";
import { createLiveInvitationService, createPostgresLiveInvitationStore, createPostgresLiveSessions } from "./live-authority.js";
import { createImmoGitRegistry } from "./registry.js";

/**
 * 0037 (provider 0011 byte copy) and 0038 (immo invitation ledger) on the
 * immo schema: the live session is read from the provider draft record and
 * an invitation is created, listed and revoked durably (epoch bump).
 */
describe.skipIf(!process.env.P0B_DATABASE_URL)("live invitations on the immo schema (0037, 0038, 0041)", () => {
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
      codeRights: { canReadCode: async ({ actorId }) => ["alice", "idp-bob"].includes(actorId) }, invitationsQualified: () => true });
    const caller = { actorId: "alice", storageScopeId: "p0b", scopes: ["immo:artifacts:read", "immo:artifacts:write"] };
    const created = await service.create(caller, { artifactId, inviteeId: "idp-bob" });
    expect(created).toMatchObject({ liveSessionId: "session-1", bindingGeneration: 1, epoch: 1 });
    expect((await service.list(caller, { artifactId })).map((row) => row.active)).toEqual([true]);
    const revoked = await service.revoke(caller, { artifactId, invitationId: created.invitationId });
    expect(revoked).toMatchObject({ epoch: 2 });
    expect((await service.revoke(caller, { artifactId, invitationId: created.invitationId })).epoch).toBe(2);
    expect((await service.list(caller, { artifactId })).map((row) => row.active)).toEqual([false]);
  });

  it("shares one session epoch across invitees, revokes one with sockets, records and push (0038, 0041)", async () => {
    const { artifactId } = await fixture.page();
    const now = new Date().toISOString();
    await fixture.pool.query("INSERT INTO account_users (sub, status) VALUES ('idp-carol', 'approved') ON CONFLICT DO NOTHING");
    const binding: GitBinding = { artifactId, storageScopeId: "p0b", repoId: "radar-immobilier",
      branch: `artifact/p/alice000/triage-${artifactId.slice(0, 8)}`, channel: "personal", personalPrincipalId: "alice",
      subPath: "", baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40), releaseCommitSha: null, autoPublish: true,
      executor: "sandbox", pendingJobId: null, pendingCommitSha: null, state: "attached", generation: 1, version: 1,
      attachedBy: "alice", attachedAt: now, updatedAt: now };
    await createPostgresGitBindingStore(fixture.pool).write({ binding, expectedVersion: null, actorId: "alice",
      idempotencyKey: `attach-${artifactId}`, commandHash: "h", event: { action: "attach" } });
    await fixture.pool.query(`INSERT INTO artifacts.live_drafts (storage_scope_id, artifact_id, binding_generation, record)
      VALUES ('p0b', $1, 1, $2)`, [artifactId, JSON.stringify({ revision: "rev-1", runtime: { liveSessionId: "session-1", phase: "LIVE",
      appliedRevision: "rev-1" } })]);
    const key = Buffer.alloc(32, 3);
    const sent: Parameters<LiveControlTransport>[0][] = [];
    const ports = composeLiveEdgePorts({ pool: fixture.pool, storageScopeId: "p0b", stage: "live", contentBase: "pages.test",
      module: liveHost, send: async (input) => { sent.push(input); return 204; },
      env: { IMMO_ARTIFACTS_LIVE_EDGE_ENABLED: "1", IMMO_ARTIFACTS_LIVE_HOST_KEYS: `immo-preprod-live-1=${key.toString("base64url")}`,
        IMMO_ARTIFACTS_LIVE_HOST_KID: "immo-preprod-live-1", IMMO_ARTIFACTS_LIVE_HOST: "pages.test",
        IMMO_ARTIFACTS_LIVE_EDGE_URL: "http://artifact-content.test:8791", IMMO_ARTIFACTS_GIT_INSTALLATION_REF: "inst",
        IMMO_ARTIFACTS_GIT_CODE_READERS: "alice,idp-bob,idp-carol", IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED: "true" } })!;
    const caller = { actorId: "alice", storageScopeId: "p0b", scopes: ["immo:artifacts:read", "immo:artifacts:write"] };
    const bob = await ports.invitations.create(caller, { artifactId, inviteeId: "idp-bob", ttlMs: 30 * 60_000 });
    const carol = await ports.invitations.create(caller, { artifactId, inviteeId: "idp-carol", ttlMs: 2 * 3600_000 });
    expect([bob.epoch, carol.epoch]).toEqual([1, 1]);
    expect(await ports.sessionState.current("p0b", artifactId, 1, "session-1"))
      .toEqual({ epoch: 1, expiresAt: Date.parse(carol.expiresAt) });
    for (const [principalId, invitationId] of [["idp-bob", bob.invitationId], ["idp-carol", carol.invitationId]] as const) {
      const record = await ports.authorizations.ensure({ storageScopeId: "p0b", artifactId, sessionId: "session-1", bindingGeneration: 1,
        principalId, role: "invitee", invitationId, expiresAt: principalId === "idp-bob" ? bob.expiresAt : carol.expiresAt });
      expect(await ports.authorizations.ensure({ ...record })).toMatchObject({ authorizationId: record.authorizationId });
    }
    const bobSocket = { close: vi.fn() };
    const carolSocket = { close: vi.fn() };
    ports.sockets.register({ artifactId, sessionId: "session-1", principalId: "idp-bob", invitationId: bob.invitationId }, bobSocket);
    ports.sockets.register({ artifactId, sessionId: "session-1", principalId: "idp-carol", invitationId: carol.invitationId }, carolSocket);
    const revoked = await ports.invitations.revoke(caller, { artifactId, invitationId: bob.invitationId });
    expect(revoked.epoch).toBe(2);
    expect(bobSocket.close).toHaveBeenCalled();
    expect(carolSocket.close).not.toHaveBeenCalled();
    // Pushed to the internal Service on the artifact's pages Host, with the NEW session epoch.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ host: `${artifactId}.pages.test`, path: "/_live-control/v1" });
    expect(verifyLiveControl(sent[0]!.headers["x-live-host-control"]!, { key: () => key, now: () => Date.now() }))
      .toMatchObject({ op: "revoke_invitation", invitationId: bob.invitationId, epoch: 2, host: `${artifactId}.pages.test` });
    // Remaining invitations adopt the new epoch; the revoked one's record is revoked, the other stays valid.
    expect((await ports.invitations.list(caller, { artifactId })).map((row) => [row.inviteeId, row.epoch, row.active]))
      .toEqual([["idp-bob", 2, false], ["idp-carol", 2, true]]);
    expect(await ports.sessionState.current("p0b", artifactId, 1, "session-1")).toEqual({ epoch: 2, expiresAt: Date.parse(carol.expiresAt) });
    const record = (principalId: string, invitationId: string) => ports.authorizations.find({ storageScopeId: "p0b", artifactId,
      sessionId: "session-1", bindingGeneration: 1, principalId, invitationId });
    expect((await record("idp-bob", bob.invitationId))?.revokedAt).not.toBeNull();
    expect((await record("idp-carol", carol.invitationId))?.revokedAt).toBeNull();
    // Idempotent revoke: no second bump, the epoch is never lowered.
    expect((await ports.invitations.revoke(caller, { artifactId, invitationId: bob.invitationId })).epoch).toBe(2);
    expect(await ports.gate("p0b", artifactId, "idp-bob")).toBeNull();
    expect(await ports.gate("p0b", artifactId, "idp-carol")).toMatchObject({ role: "invitee", epoch: 2 });
    // Owner "stop sharing now": every open session revoked, then revoke_session pushed.
    expect(await ports.authorizations.openSessions("p0b", artifactId)).toEqual(["session-1"]);
    await ports.revocation.session(artifactId, "session-1");
    expect(carolSocket.close).toHaveBeenCalled();
    expect((await record("idp-carol", carol.invitationId))?.revokedAt).not.toBeNull();
    // (The idempotent revoke above re-pushed the same floor; the last push is the session one.)
    expect(verifyLiveControl(sent.at(-1)!.headers["x-live-host-control"]!, { key: () => key, now: () => Date.now() }))
      .toMatchObject({ op: "revoke_session", sessionId: "session-1", epoch: 0 });
  });
});
