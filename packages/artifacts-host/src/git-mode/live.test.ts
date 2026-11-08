import { createLiveService, createMemoryGitBindingStore, type GitBinding, type GitBindingStore, type GitCodeRightsPort } from "@sentropic/artifacts";
import { beforeEach, describe, expect, it } from "vitest";
import { createStaticGitHumanDirectory } from "./identity.js";
import {
  createLiveAuthorize, createLiveReaderGate,
} from "./live-authority.js";
import { createImmoGitRegistry, IMMO_GIT_REPO_ID } from "./registry.js";
import { composeGitMode, readGitModeConfig } from "./compose.js";
import { FAIL_CLOSED_LIVE_KEYS } from "./live.js";

const SCOPE = "radar-immobilier-test";
const NOW = Date.parse("2026-11-08T00:00:00.000Z");
const A_ALICE = "11111111-1111-4111-8111-111111111111";
const A_BOB = "22222222-2222-4222-8222-222222222222";

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

let bindings: GitBindingStore;
let writeScope = true;

async function attach(binding: GitBinding) {
  await bindings.write({ binding, expectedVersion: null, actorId: binding.attachedBy, idempotencyKey: `k-${binding.artifactId}`,
    commandHash: "h", event: { action: "attach" } });
}

function deps() {
  return { bindings, codeRights, directory, hasWriteScope: () => writeScope,
    qualified: () => false, registry: createImmoGitRegistry({ storageScopeId: SCOPE, installationRef: "inst" }) };
}
const inv = (actorId: string) => ({ actorId, storageScopeId: SCOPE, invocationId: `i-${actorId}` });

beforeEach(async () => {
  bindings = createMemoryGitBindingStore();
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

  it("refuses the provider write path to a third party", async () => {
    const service = createLiveService({ store: {} as never, keys: {} as never, git: {} as never, authorize: createLiveAuthorize(deps()) });
    await expect(service.execute("live_write", { artifactId: A_ALICE, expectedHeadSha: "a".repeat(40),
      expectedLiveRevision: "r1", idempotencyKey: "k1", edits: [{ path: "ui/src/a.ts", oldStr: "a", newStr: "b" }] }, inv("bob")))
      .rejects.toMatchObject({ kind: "access_denied" });
  });
});

describe("live authority with the generic invitations (0.2.22)", () => {
  const viewerOf = (answer: unknown) => ({ qualified: () => true, viewer: async () => answer as never });

  it("stays owner-only while the invitations are not qualified, whatever the viewer says", async () => {
    const off = { qualified: () => false, viewer: async () => { throw new Error("never consulted"); } };
    await expect(createLiveAuthorize({ ...deps(), invitations: off })(inv("carol"), A_ALICE)).rejects.toMatchObject({ kind: "access_denied" });
  });

  it("admits a non-owner as an invitee (read only, no write) when qualified; the owner stays the owner", async () => {
    const invitee = viewerOf({ role: "invitee", invitation: { id: "inv-1", epoch: 1, expiresAt: NOW + 1000 } });
    const authority = await createLiveAuthorize({ ...deps(), invitations: invitee })(inv("bob"), A_ALICE);
    expect(authority).toMatchObject({ ownerId: "alice", invited: true, canReadCode: true, canWrite: false,
      target: { principalId: "bob" } });
    const pending = await createLiveAuthorize({ ...deps(), invitations: viewerOf(null) })(inv("bob"), A_ALICE);
    expect(pending).toMatchObject({ ownerId: "alice", invited: false, canWrite: false });
    const owner = await createLiveAuthorize({ ...deps(), invitations: viewerOf(null) })(inv("alice"), A_ALICE);
    expect(owner).toMatchObject({ ownerId: "alice", invited: false, canWrite: true });
  });

  it("keeps the provider write path closed to an invitee (owner-only operation)", async () => {
    const invitee = viewerOf({ role: "invitee", invitation: { id: "inv-1", epoch: 1, expiresAt: NOW + 1000 } });
    const service = createLiveService({ store: {} as never, keys: {} as never, git: {} as never,
      authorize: createLiveAuthorize({ ...deps(), invitations: invitee }) });
    await expect(service.execute("live_write", { artifactId: A_ALICE, expectedHeadSha: "a".repeat(40),
      expectedLiveRevision: "r1", idempotencyKey: "k1", edits: [{ path: "ui/src/a.ts", oldStr: "a", newStr: "b" }] }, inv("bob")))
      .rejects.toMatchObject({ kind: "access_denied" });
  });
});

describe("live reader gate (owner-only unless the invitations are qualified, 0.2.22)", () => {
  it("admits the binding owner with code rights and refuses everybody else", async () => {
    expect(await createLiveReaderGate(deps())(SCOPE, A_ALICE, "alice")).toEqual({ role: "binding_owner", principalId: "alice",
      bindingGeneration: 1 });
    expect(await createLiveReaderGate(deps())(SCOPE, A_ALICE, "bob")).toBeNull();
    expect(await createLiveReaderGate(deps())(SCOPE, A_ALICE, "carol")).toBeNull();
    expect(await createLiveReaderGate(deps())(SCOPE, A_ALICE, "mallory")).toBeNull();
    const noRights = { ...deps(), codeRights: { canReadCode: async () => false } };
    expect(await createLiveReaderGate(noRights)(SCOPE, A_ALICE, "alice")).toBeNull();
  });
});

describe("live stage composition (fail-closed stubs)", () => {
  const resolution = { stage: "live", tools: ["artifacts_git_attach", "artifacts_fetch_app_source", "artifacts_git_publish",
    "artifacts_git_commit", "artifacts_live_write", "artifacts_live_read", "artifacts_live_reset", "artifacts_live_status",
    "artifacts_live_control", "artifacts_live_invite", "artifacts_live_accept_invitation", "artifacts_live_revoke_invitation",
    "artifacts_live_invitations"], unrouted: [] } as const;
  const compose = () => composeGitMode({ resolution, pool: { query: async () => ({ rows: [] }) } as never, storageScopeId: SCOPE,
    config: { codeReaders: [], humans: [], installationRef: "inst" }, ports: { bindings, codeRights, directory,
      hasWriteScope: () => true, liveStore: {} as never, gitToolFactory: () => ({ execute: async () => ({}) }) } });
  const write = { artifactId: A_ALICE, expectedHeadSha: "a".repeat(40), expectedLiveRevision: "r1", idempotencyKey: "k1",
    edits: [{ path: "ui/src/a.ts", oldStr: "a", newStr: "b" }] };

  it("answers builder_unavailable on every invitation tool while invitations are not qualified (default)", async () => {
    const live = compose().live!;
    const ids = { artifactId: A_ALICE, idempotencyKey: "k1" };
    const uuid = "33333333-3333-4333-8333-333333333333";
    for (const [operation, args] of [
      ["live_invite", { ...ids, liveSessionId: uuid, userRef: uuid, expiresInSeconds: 600 }],
      ["live_accept_invitation", { ...ids, invitationId: uuid }],
      ["live_revoke_invitation", { ...ids, invitationId: uuid }],
      ["live_invitations", { artifactId: A_ALICE }],
    ] as const) {
      await expect(live.execute(operation, args, inv("alice"))).rejects.toMatchObject({ kind: "builder_unavailable" });
    }
  });

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
      ports: { bindings, codeRights, directory, hasWriteScope: () => true, liveStore: {} as never,
        liveQualified: () => true, gitToolFactory: () => ({ execute: async () => ({}) }) } });
    // Flag off: the no-worker composition, unchanged (builder_unavailable even when qualified).
    await expect(withConfig(false).live!.execute("live_write", write, inv("alice"))).rejects.toMatchObject({ kind: "builder_unavailable" });
    // Flag on: a worker is present, so the write goes past the worker check (and fails later on the stub store).
    const error = await withConfig(true).live!.execute("live_write", write, inv("alice")).catch((caught: unknown) => caught);
    expect(error).not.toMatchObject({ kind: "builder_unavailable" });
  });

  it("reads both qualification flags from the configuration, default off (owner-recorded GB4 GO only)", () => {
    expect(readGitModeConfig({})).toMatchObject({ liveQualified: false, liveInvitationsQualified: false, liveEdgeEnabled: false });
    expect(readGitModeConfig({ IMMO_ARTIFACTS_LIVE_QUALIFIED: "1", IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED: "yes" }))
      .toMatchObject({ liveQualified: false, liveInvitationsQualified: false });
    expect(readGitModeConfig({ IMMO_ARTIFACTS_LIVE_QUALIFIED: "true", IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED: "true" }))
      .toMatchObject({ liveQualified: true, liveInvitationsQualified: true });
  });

  it("keeps draft keys closed", async () => {
    await expect(FAIL_CLOSED_LIVE_KEYS.current({ storageScopeId: SCOPE, artifactId: A_ALICE, bindingGeneration: 1 }))
      .rejects.toMatchObject({ kind: "provider_unavailable" });
  });
});
