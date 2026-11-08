import { createLiveService, createMemoryGitBindingStore, type GitBinding, type GitBindingStore, type GitCodeRightsPort } from "@sentropic/artifacts";
import { beforeEach, describe, expect, it } from "vitest";
import { createStaticGitHumanDirectory } from "./identity.js";
import {
  createLiveAuthorize, createLiveInvitationService, createLiveReaderGate, createMemoryLiveInvitationStore,
  type LiveInvitationStore, type LiveSessionPort,
} from "./live-authority.js";
import { createImmoGitRegistry, IMMO_GIT_REPO_ID } from "./registry.js";
import { composeGitMode } from "./compose.js";
import { FAIL_CLOSED_LIVE_KEYS } from "./live.js";

const SCOPE = "radar-immobilier-test";
const NOW = Date.parse("2026-11-08T00:00:00.000Z");
const A_ALICE = "11111111-1111-4111-8111-111111111111";
const A_BOB = "22222222-2222-4222-8222-222222222222";
const WRITE = ["immo:artifacts:read", "immo:artifacts:write"];

function personal(artifactId: string, owner: string): GitBinding {
  return { artifactId, storageScopeId: SCOPE, repoId: IMMO_GIT_REPO_ID, branch: `artifact/p/${owner}00/triage-${artifactId.slice(0, 8)}`,
    channel: "personal", personalPrincipalId: owner, subPath: "", baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40),
    releaseCommitSha: null, autoPublish: true, executor: "sandbox", pendingJobId: null, pendingCommitSha: null, state: "attached",
    generation: 1, version: 1, attachedBy: owner, attachedAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() };
}

/** alice, bob and carol hold code rights; mallory does not. alice and bob have a GitHub linkage. */
const codeRights: GitCodeRightsPort = { canReadCode: async ({ actorId }) => ["alice", "bob", "carol"].includes(actorId) };
const directory = createStaticGitHumanDirectory([
  { principalId: "alice", name: "Alice", email: "1+alice@users.noreply.github.com" },
  { principalId: "bob", name: "Bob", email: "2+bob@users.noreply.github.com" }]);
const sessions: LiveSessionPort = { current: async (binding) => ({ liveSessionId: `session-${binding.artifactId}-${binding.generation}` }) };

let bindings: GitBindingStore;
let invitations: LiveInvitationStore;
let now = NOW;
let writeScope = true;

async function attach(binding: GitBinding) {
  await bindings.write({ binding, expectedVersion: null, actorId: binding.attachedBy, idempotencyKey: `k-${binding.artifactId}`,
    commandHash: "h", event: { action: "attach" } });
}

function deps() {
  return { bindings, invitations, sessions, codeRights, directory, now: () => now, hasWriteScope: () => writeScope,
    qualified: () => false, registry: createImmoGitRegistry({ storageScopeId: SCOPE, installationRef: "inst" }) };
}
const inv = (actorId: string) => ({ actorId, storageScopeId: SCOPE, invocationId: `i-${actorId}` });
const caller = (actorId: string, scopes = WRITE) => ({ actorId, storageScopeId: SCOPE, scopes });

beforeEach(async () => {
  bindings = createMemoryGitBindingStore();
  invitations = createMemoryLiveInvitationStore();
  now = NOW;
  writeScope = true;
  await attach(personal(A_ALICE, "alice"));
  await attach(personal(A_BOB, "bob"));
});

describe("live authority: each user edits their own binding (Δ4)", () => {
  it("gives the binding owner write authority with code rights, write scope and GitHub linkage", async () => {
    const authority = await createLiveAuthorize(deps())(inv("alice"), A_ALICE);
    expect(authority).toMatchObject({ ownerId: "alice", canReadCode: true, canWrite: true, humanLinked: true, invited: false,
      qualified: false, target: { principalId: "alice", outputDir: "ui/dist" } });
  });

  it("lets a second code-rights holder edit their OWN binding", async () => {
    const authority = await createLiveAuthorize(deps())(inv("bob"), A_BOB);
    expect(authority).toMatchObject({ ownerId: "bob", canWrite: true, humanLinked: true });
  });

  it("withholds write authority without the host write scope", async () => {
    writeScope = false;
    expect((await createLiveAuthorize(deps())(inv("alice"), A_ALICE)).canWrite).toBe(false);
  });

  it("refuses a third party on another user's binding, even with code rights", async () => {
    await expect(createLiveAuthorize(deps())(inv("bob"), A_ALICE)).rejects.toMatchObject({ kind: "access_denied" });
    await expect(createLiveAuthorize(deps())(inv("carol"), A_ALICE)).rejects.toMatchObject({ kind: "access_denied" });
  });

  it("refuses a stranger without code rights", async () => {
    await expect(createLiveAuthorize(deps())(inv("mallory"), A_ALICE)).rejects.toMatchObject({ kind: "access_denied" });
  });

  it("refuses the provider write path to a third party holding an invitation", async () => {
    await createLiveInvitationService(deps()).create(caller("alice"), { artifactId: A_ALICE, inviteeId: "bob" });
    const service = createLiveService({ store: {} as never, keys: {} as never, git: {} as never, authorize: createLiveAuthorize(deps()) });
    await expect(service.execute("live_write", { artifactId: A_ALICE, expectedHeadSha: "a".repeat(40),
      expectedLiveRevision: "r1", idempotencyKey: "k1", edits: [{ path: "ui/src/a.ts", oldStr: "a", newStr: "b" }] }, inv("bob")))
      .rejects.toMatchObject({ kind: "access_denied" });
  });
});

describe("live invitations", () => {
  it("lets an invited reader with code rights read the owner's session, without write authority", async () => {
    const service = createLiveInvitationService(deps());
    const invitation = await service.create(caller("alice"), { artifactId: A_ALICE, inviteeId: "carol" });
    expect(invitation).toMatchObject({ grantorId: "alice", inviteeId: "carol", bindingGeneration: 1, epoch: 1, revokedAt: null,
      liveSessionId: `session-${A_ALICE}-1` });
    const authority = await createLiveAuthorize(deps())(inv("carol"), A_ALICE);
    expect(authority).toMatchObject({ ownerId: "alice", invited: true, canReadCode: true, canWrite: false, humanLinked: false });
    expect(await createLiveReaderGate(deps())(SCOPE, A_ALICE, "carol")).toMatchObject({ role: "invitee",
      invitationId: invitation.invitationId, epoch: 1 });
    expect(await createLiveReaderGate(deps())(SCOPE, A_ALICE, "alice")).toMatchObject({ role: "binding_owner" });
  });

  it("refuses a revoked invitee on the very next call", async () => {
    const service = createLiveInvitationService(deps());
    const invitation = await service.create(caller("alice"), { artifactId: A_ALICE, inviteeId: "carol" });
    await createLiveAuthorize(deps())(inv("carol"), A_ALICE);
    const revoked = await service.revoke(caller("alice"), { artifactId: A_ALICE, invitationId: invitation.invitationId });
    expect(revoked).toMatchObject({ epoch: 2 });
    expect(revoked.revokedAt).not.toBeNull();
    await expect(createLiveAuthorize(deps())(inv("carol"), A_ALICE)).rejects.toMatchObject({ kind: "access_denied" });
    expect(await createLiveReaderGate(deps())(SCOPE, A_ALICE, "carol")).toBeNull();
  });

  it("ends an invitation on expiry, on a new session and on a new generation", async () => {
    const service = createLiveInvitationService(deps());
    await service.create(caller("alice"), { artifactId: A_ALICE, inviteeId: "carol", ttlMs: 60_000 });
    now = NOW + 60_000;
    await expect(createLiveAuthorize(deps())(inv("carol"), A_ALICE)).rejects.toMatchObject({ kind: "access_denied" });
    now = NOW;
    const moved = { ...deps(), sessions: { current: async () => ({ liveSessionId: "another-session" }) } };
    await expect(createLiveAuthorize(moved)(inv("carol"), A_ALICE)).rejects.toMatchObject({ kind: "access_denied" });
    const stopped = { ...deps(), sessions: { current: async () => undefined } };
    await expect(createLiveAuthorize(stopped)(inv("carol"), A_ALICE)).rejects.toMatchObject({ kind: "access_denied" });
    const before = (await bindings.get(SCOPE, A_ALICE))!;
    await bindings.write({ binding: { ...before, state: "paused", generation: 2, version: 2 }, expectedVersion: 1,
      actorId: "alice", idempotencyKey: "pause", commandHash: "h2", event: { action: "pause" } });
    await expect(createLiveAuthorize(deps())(inv("carol"), A_ALICE)).rejects.toMatchObject({ kind: "access_denied" });
  });

  it("refuses an invitee without code rights, and invitation operations by anyone but the binding owner", async () => {
    const service = createLiveInvitationService(deps());
    await expect(service.create(caller("alice"), { artifactId: A_ALICE, inviteeId: "mallory" })).rejects.toMatchObject({ kind: "access_denied" });
    await expect(service.create(caller("bob"), { artifactId: A_ALICE, inviteeId: "carol" })).rejects.toMatchObject({ kind: "access_denied" });
    await expect(service.create(caller("alice", ["immo:artifacts:read"]), { artifactId: A_ALICE, inviteeId: "carol" }))
      .rejects.toMatchObject({ kind: "access_denied" });
    await expect(service.create(caller("alice"), { artifactId: A_ALICE, inviteeId: "alice" })).rejects.toMatchObject({ kind: "invalid_request" });
    await expect(service.create(caller("alice"), { artifactId: A_ALICE, inviteeId: "carol", ttlMs: 9 * 3600_000 }))
      .rejects.toMatchObject({ kind: "invalid_request" });
    const created = await service.create(caller("alice"), { artifactId: A_ALICE, inviteeId: "carol" });
    expect((await service.list(caller("alice", ["immo:artifacts:read"]), { artifactId: A_ALICE })).map((row) => [row.inviteeId, row.active]))
      .toEqual([["carol", true]]);
    await expect(service.list(caller("bob"), { artifactId: A_ALICE })).rejects.toMatchObject({ kind: "access_denied" });
    await expect(service.revoke(caller("bob"), { artifactId: A_ALICE, invitationId: created.invitationId }))
      .rejects.toMatchObject({ kind: "access_denied" });
  });

  it("caps an invitation at the announced session end and refuses one for an ended session", async () => {
    const ending = { ...deps(), sessions: { current: async (binding: GitBinding) => ({
      liveSessionId: `session-${binding.artifactId}-${binding.generation}`, expiresAt: new Date(NOW + 10 * 60_000).toISOString() }) } };
    const capped = await createLiveInvitationService(ending).create(caller("alice"), { artifactId: A_ALICE, inviteeId: "carol" });
    expect(capped.expiresAt).toBe(new Date(NOW + 10 * 60_000).toISOString());
    now = NOW + 10 * 60_000;
    await expect(createLiveAuthorize(ending)(inv("carol"), A_ALICE)).rejects.toMatchObject({ kind: "access_denied" });
    await expect(createLiveInvitationService(ending).create(caller("alice"), { artifactId: A_ALICE, inviteeId: "carol" }))
      .rejects.toMatchObject({ kind: "git_not_attached" });
  });

  it("does not let an invitation on one binding open another", async () => {
    await createLiveInvitationService(deps()).create(caller("alice"), { artifactId: A_ALICE, inviteeId: "carol" });
    await expect(createLiveAuthorize(deps())(inv("carol"), A_BOB)).rejects.toMatchObject({ kind: "access_denied" });
  });
});

describe("live stage composition (fail-closed stubs)", () => {
  const resolution = { stage: "live", tools: ["artifacts_git_attach", "artifacts_fetch_app_source", "artifacts_git_publish",
    "artifacts_git_commit", "artifacts_live_write", "artifacts_live_read", "artifacts_live_reset", "artifacts_live_status",
    "artifacts_live_control"], unrouted: [] } as const;
  const compose = () => composeGitMode({ resolution, pool: { query: async () => ({ rows: [] }) } as never, storageScopeId: SCOPE,
    config: { codeReaders: [], humans: [], installationRef: "inst" }, ports: { bindings, codeRights, directory, invitations, sessions,
      hasWriteScope: () => true, liveStore: {} as never, gitToolFactory: () => ({ execute: async () => ({}) }) } });
  const write = { artifactId: A_ALICE, expectedHeadSha: "a".repeat(40), expectedLiveRevision: "r1", idempotencyKey: "k1",
    edits: [{ path: "ui/src/a.ts", oldStr: "a", newStr: "b" }] };

  it("routes live_* and git_commit to a LiveService only in the live stage", () => {
    expect(compose().live).toBeDefined();
    expect(composeGitMode({ resolution: { stage: "bindings", tools: ["artifacts_git_attach"], unrouted: [] },
      pool: {} as never, storageScopeId: SCOPE, config: { codeReaders: [], humans: [] },
      ports: { bindings, gitToolFactory: () => ({ execute: async () => ({}) }) } }).live).toBeUndefined();
  });

  it("answers builder_unavailable to the binding owner until a qualified worker exists", async () => {
    await expect(compose().live!.execute("live_write", write, inv("alice"))).rejects.toMatchObject({ kind: "builder_unavailable" });
  });

  it("refuses the same write to a third party", async () => {
    await expect(compose().live!.execute("live_write", write, inv("bob"))).rejects.toMatchObject({ kind: "access_denied" });
  });

  it("composes the controller worker only with IMMO_ARTIFACTS_LIVE_EDGE_ENABLED on top of stage live", async () => {
    const withConfig = (liveEdgeEnabled: boolean) => composeGitMode({ resolution, pool: { query: async () => ({ rows: [] }) } as never,
      storageScopeId: SCOPE, config: { codeReaders: [], humans: [], installationRef: "inst", liveEdgeEnabled,
        builderUrl: "https://preprod.sentropic.sent-tech.ca/api/v1/artifacts/builder" },
      ports: { bindings, codeRights, directory, invitations, sessions, hasWriteScope: () => true, liveStore: {} as never,
        liveQualified: () => true, gitToolFactory: () => ({ execute: async () => ({}) }) } });
    // Flag off: the no-worker composition, unchanged (builder_unavailable even when qualified).
    await expect(withConfig(false).live!.execute("live_write", write, inv("alice"))).rejects.toMatchObject({ kind: "builder_unavailable" });
    // Flag on: a worker is present, so the write goes past the worker check (and fails later on the stub store).
    const error = await withConfig(true).live!.execute("live_write", write, inv("alice")).catch((caught: unknown) => caught);
    expect(error).not.toMatchObject({ kind: "builder_unavailable" });
  });

  it("keeps draft keys closed", async () => {
    await expect(FAIL_CLOSED_LIVE_KEYS.current({ storageScopeId: SCOPE, artifactId: A_ALICE, bindingGeneration: 1 }))
      .rejects.toMatchObject({ kind: "provider_unavailable" });
  });
});
