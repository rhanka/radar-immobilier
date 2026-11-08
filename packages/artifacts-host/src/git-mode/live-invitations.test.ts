import { createMemoryGitBindingStore, type GitBinding, type GitBindingStore, type LiveInvitationRevoked } from "@sentropic/artifacts";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createLiveReaderGate } from "./live-authority.js";
import { admitLive, LIVE_HTTP_ASSERTION_SECONDS, type LiveReadinessPort } from "./live-forward.js";
import { createLiveGrantClient, livePodName, type LiveGrant } from "./live-grant.js";
import { createLiveSocketRegistry } from "./live-edge.js";
import { createInvitationDirectory, createInvitationRevoker, createLiveInvitationPort } from "./live-invitations.js";
import { createImmoGitRegistry, IMMO_GIT_REPO_ID } from "./registry.js";

const SCOPE = "radar-immobilier-preprod";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const HOST = `${ARTIFACT}.pages.preprod.immo.sent-tech.ca`;
const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const EXPIRES = NOW + 600_000;

describe("invitations directory port (fail closed)", () => {
  const person = { userRef: "00000000-0000-4000-8000-000000000001", displayName: "Bob", email: "bob@example.test" };
  it("resolves a known userRef and projects no email", async () => {
    const port = createInvitationDirectory({ resolvePrincipal: async (_s, ref) => ref === person.userRef ? "idp-bob" : undefined,
      describePrincipal: async () => person });
    expect(await port.resolvePrincipal(SCOPE, person.userRef)).toBe("idp-bob");
    expect(await port.describePrincipal(SCOPE, "idp-bob")).toEqual({ userRef: person.userRef, displayName: "Bob", email: "" });
  });

  it("answers nothing for an unknown user, an empty answer or a directory failure", async () => {
    const boom = async () => { throw new Error("db down"); };
    const unknown = createInvitationDirectory({ resolvePrincipal: async () => undefined, describePrincipal: async () => undefined });
    expect(await unknown.resolvePrincipal(SCOPE, "nobody")).toBeUndefined();
    expect(await unknown.describePrincipal(SCOPE, "nobody")).toBeUndefined();
    const empty = createInvitationDirectory({ resolvePrincipal: async () => "" as never, describePrincipal: async () => undefined });
    expect(await empty.resolvePrincipal(SCOPE, "x")).toBeUndefined();
    const failing = createInvitationDirectory({ resolvePrincipal: boom, describePrincipal: boom });
    expect(await failing.resolvePrincipal(SCOPE, "x")).toBeUndefined();
    expect(await failing.describePrincipal(SCOPE, "x")).toBeUndefined();
  });

  it("carries qualified as given and is off by default for the caller", () => {
    const directory = { resolvePrincipal: async () => undefined, describePrincipal: async () => undefined };
    const revoker = async () => undefined;
    expect(createLiveInvitationPort({ qualified: false, directory, revoker }).qualified).toBe(false);
    expect(createLiveInvitationPort({ qualified: true, directory, revoker }).qualified).toBe(true);
  });
});

describe("onRevoked: sockets first, then the control push until 204", () => {
  const event: LiveInvitationRevoked = { storageScopeId: SCOPE, artifactId: ARTIFACT, liveSessionId: "sess-1",
    bindingGeneration: 1, invitationId: "inv-1", epoch: 4 };

  it("closes the tracked sockets of the invitation before the first push, and pushes the new epoch", async () => {
    const sockets = createLiveSocketRegistry();
    const trace: string[] = [];
    sockets.register({ artifactId: ARTIFACT, sessionId: "ctl-1", principalId: "bob", invitationId: "inv-1", liveSessionId: "sess-1" },
      { close: () => trace.push("socket-closed") });
    sockets.register({ artifactId: ARTIFACT, sessionId: "ctl-1", principalId: "carol", invitationId: "inv-2", liveSessionId: "sess-1" },
      { close: () => trace.push("other-closed") });
    const push = vi.fn(async (claims: unknown) => { trace.push("push"); void claims; });
    await createInvitationRevoker({ sockets, push, sleep: async () => undefined })(event);
    expect(trace).toEqual(["socket-closed", "push"]);
    expect(push).toHaveBeenCalledWith({ artifactId: ARTIFACT, op: "revoke_invitation", sessionId: "", invitationId: "inv-1", epoch: 4 });
    expect(sockets.size()).toBe(1);
  });

  it("retries a failing push until it succeeds, then stops", async () => {
    const push = vi.fn()
      .mockRejectedValueOnce(new Error("status 0")).mockRejectedValueOnce(new Error("status 500")).mockResolvedValue(undefined);
    const sleeps: number[] = [];
    await createInvitationRevoker({ sockets: createLiveSocketRegistry(), push, backoffMs: (attempt) => attempt + 1,
      sleep: async (ms) => { sleeps.push(ms); } })(event);
    expect(push).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1, 2]);
  });

  it("surfaces the last failure after the bounded attempts (the replayed revoke re-invokes it); sockets stay closed", async () => {
    const sockets = createLiveSocketRegistry();
    const close = vi.fn();
    sockets.register({ artifactId: ARTIFACT, sessionId: "ctl-1", principalId: "bob", invitationId: "inv-1" }, { close });
    const push = vi.fn(async () => { throw new Error("push_failed"); });
    await expect(createInvitationRevoker({ sockets, push, attempts: 3, sleep: async () => undefined })(event)).rejects.toThrow("push_failed");
    expect(push).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("§8.2 gate with the package liveViewer", () => {
  const binding: GitBinding = { artifactId: ARTIFACT, storageScopeId: SCOPE, repoId: IMMO_GIT_REPO_ID,
    branch: "artifact/p/alice000/triage-11111111", channel: "personal", personalPrincipalId: "alice", subPath: "",
    baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40), releaseCommitSha: null, autoPublish: true, executor: "sandbox",
    pendingJobId: null, pendingCommitSha: null, state: "attached", generation: 1, version: 1, attachedBy: "alice",
    attachedAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() };
  const registry = createImmoGitRegistry({ storageScopeId: SCOPE, installationRef: "inst" });
  const codeRights = { canReadCode: async ({ actorId }: { actorId: string }) => ["alice", "bob"].includes(actorId) };
  let bindings: GitBindingStore;
  let fetcher: Mock<(url: URL, init: RequestInit) => Promise<Response>>;
  const viewer = vi.fn();
  const invitationState = vi.fn(async () => ({ epoch: 3, expiresAt: EXPIRES }));

  const ports = (qualified: boolean) => {
    const readiness: LiveReadinessPort = { current: async () => ({ revision: "rev-7", ready: true, liveSessionId: "sess-1", ownerId: "alice" }) };
    const grants = createLiveGrantClient({ baseUrl: "https://builder.test/api/v1/artifacts/builder",
      identity: { authorization: async () => "Bearer t" }, fetch: fetcher as never, now: () => NOW });
    return { storageScopeId: SCOPE, readiness, grants, consent: async () => true,
      gate: createLiveReaderGate({ bindings, registry, codeRights, ...(qualified ? { viewer: viewer as never } : {}) }),
      ...(qualified ? { invitationState } : {}) };
  };
  const admit = (principalId: string, qualified: boolean, lifetimeSeconds = LIVE_HTTP_ASSERTION_SECONDS) =>
    admitLive(ports(qualified), { host: HOST, artifactId: ARTIFACT, principalId, kid: "immo-preprod-live-1", nowMs: NOW, lifetimeSeconds });

  beforeEach(async () => {
    bindings = createMemoryGitBindingStore();
    await bindings.write({ binding, expectedVersion: null, actorId: "alice", idempotencyKey: "k", commandHash: "h", event: { action: "attach" } });
    viewer.mockReset();
    invitationState.mockClear();
    fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { actor: { principalId: string; invitation?: { id: string; epoch: number; expiresAt: number } };
        invitation: { epoch: number } };
      const invitee = body.actor.invitation;
      const grant: LiveGrant = { storageScopeId: SCOPE, artifactId: ARTIFACT, sessionId: "ctl-1", generation: 1, routeEpoch: 2,
        podUid: "pod-uid-1", podName: livePodName(SCOPE, ARTIFACT), sourceRevision: "rev-7", principalId: body.actor.principalId,
        role: invitee ? "invitee" : "binding_owner", invitationId: invitee?.id ?? "", invitationEpoch: invitee ? body.invitation.epoch : 0,
        invitationExp: invitee ? Math.floor(invitee.expiresAt / 1000) : 0 };
      return new Response(JSON.stringify({ grant }), { status: 200 });
    });
  });

  it("not qualified: owner-only, the invitee is refused and liveViewer is never consulted", async () => {
    viewer.mockResolvedValue({ role: "invitee", invitation: { id: "inv-1", epoch: 3, expiresAt: EXPIRES } });
    expect(await admit("bob", false)).toEqual({ kind: "none" });
    expect(viewer).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await admit("alice", false)).toMatchObject({ kind: "live", claims: { role: "binding_owner", invitationEpoch: 0 } });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1].body)).invitation).toEqual({ epoch: 0, expiresAt: null });
  });

  it("qualified: admits an accepted invitee, sends invitation and session state, and caps the websocket at the invitation expiry", async () => {
    viewer.mockResolvedValue({ role: "invitee", invitation: { id: "inv-1", epoch: 3, expiresAt: EXPIRES } });
    const result = await admit("bob", true, 3600);
    expect(viewer).toHaveBeenCalledWith({ storageScopeId: SCOPE, artifactId: ARTIFACT, bindingGeneration: 1 }, "bob");
    expect(result).toMatchObject({ kind: "live", claims: { role: "invitee", principalId: "bob", invitationId: "inv-1",
      invitationEpoch: 3, invitationExp: Math.floor(EXPIRES / 1000), exp: Math.floor(EXPIRES / 1000) } });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1].body))).toMatchObject({ actor: { principalId: "bob",
      invitation: { id: "inv-1", epoch: 3, expiresAt: EXPIRES } }, invitation: { epoch: 3, expiresAt: EXPIRES } });
  });

  it("qualified: a principal that is not an active invitee, or a viewer failure, is refused", async () => {
    viewer.mockResolvedValue(null);
    expect(await admit("bob", true)).toEqual({ kind: "none" });
    viewer.mockRejectedValue(new Error("store down"));
    expect(await admit("bob", true)).toEqual({ kind: "none" });
    expect(await admit("mallory", true)).toEqual({ kind: "none" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("qualified: the owner path stays owner and still carries the session invitation state", async () => {
    expect(await admit("alice", true)).toMatchObject({ kind: "live", claims: { role: "binding_owner" } });
    expect(viewer).not.toHaveBeenCalled();
    expect(JSON.parse(String(fetcher.mock.calls[0]![1].body))).toMatchObject({ actor: { principalId: "alice" }, invitation: { epoch: 3 } });
  });
});
