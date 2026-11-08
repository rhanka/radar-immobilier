import { describe, expect, it, vi } from "vitest";
import {
  createEpochFloor, createLiveGrantClient, createLiveWorkerClient, LIVE_GRANT_CACHE_MS, livePodName, parseLiveGrant,
  type LiveGrant, type LiveGrantRequest, type LiveSessionInvitationState,
} from "./live-grant.js";
import { planDraft, type LiveDraftSnapshot } from "./live-draft-stager.js";
import { liveStoreFences } from "./live.js";

const BASE = "https://preprod.sentropic.sent-tech.ca/api/v1/artifacts/builder";
const SCOPE = "radar-immobilier-preprod";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const OWNER = "1b9b9e15-0000-4000-8000-000000000001";
const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);
const identity = { authorization: vi.fn(async () => "Bearer s2s-token") };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status,
  headers: { "content-type": "application/json" } });
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

const ownerGrant = (over: Partial<LiveGrant> = {}): LiveGrant => ({ storageScopeId: SCOPE, artifactId: ARTIFACT, sessionId: "sess-1",
  generation: 1, routeEpoch: 3, podUid: "pod-uid-1", podName: livePodName(SCOPE, ARTIFACT), sourceRevision: "rev-7",
  principalId: "alice", role: "binding_owner", invitationId: "", invitationEpoch: 0, invitationExp: 0, ...over });
const INVITE_EXP_MS = Date.parse("2026-11-08T12:00:00.000Z");
const ownerRequest = (epoch = 0, expiresAt: number | null = null): LiveGrantRequest => ({ artifactId: ARTIFACT, bindingGeneration: 1,
  principalId: "alice", session: { epoch, expiresAt } });
const inviteeRequest = (epoch = 1): LiveGrantRequest => ({ artifactId: ARTIFACT, bindingGeneration: 1, principalId: "carol",
  session: { epoch, expiresAt: INVITE_EXP_MS }, invitation: { id: "inv-1", expiresAt: INVITE_EXP_MS } });
const inviteeGrant = (epoch = 1) => ownerGrant({ principalId: "carol", role: "invitee", invitationId: "inv-1", invitationEpoch: epoch,
  invitationExp: Math.floor(INVITE_EXP_MS / 1000) });

describe("live grant client (POST v1/live/grant)", () => {
  it("sends the contract body with the S2S bearer and the session invitation state (owner: epoch 0, null)", async () => {
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never });
    await expect(client.grant(ownerRequest())).resolves.toEqual({ kind: "granted", grant: ownerGrant() });
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE}/v1/live/grant`);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s2s-token");
    expect(bodyOf(fetcher.mock.calls[0]!)).toEqual({ artifactId: ARTIFACT, access: "read", actor: { principalId: "alice" },
      invitation: { epoch: 0, expiresAt: null } });
  });

  it("sends the same session state for the owner and an invitee; the invitee carries the session epoch", async () => {
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) =>
      json(200, { grant: JSON.parse(String(init.body)).actor.invitation ? inviteeGrant(2) : ownerGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never });
    await expect(client.grant(inviteeRequest(2))).resolves.toMatchObject({ kind: "granted", grant: { role: "invitee", invitationEpoch: 2 } });
    await expect(client.grant(ownerRequest(2, INVITE_EXP_MS))).resolves.toMatchObject({ kind: "granted", grant: { invitationEpoch: 0 } });
    const [invitee, owner] = fetcher.mock.calls.map(bodyOf);
    expect(invitee).toEqual({ artifactId: ARTIFACT, access: "read",
      actor: { principalId: "carol", invitation: { id: "inv-1", epoch: 2, expiresAt: INVITE_EXP_MS } },
      invitation: { epoch: 2, expiresAt: INVITE_EXP_MS } });
    // The owner never sends 0 once an epoch >= 1 exists: same session state as the invitee.
    expect(owner.invitation).toEqual(invitee.invitation);
  });

  it("never lowers the epoch sent for a binding generation", async () => {
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never });
    await client.grant(ownerRequest(3));
    client.invalidate(ARTIFACT);
    await client.grant(ownerRequest(1));
    client.invalidate(ARTIFACT);
    await client.grant({ ...ownerRequest(0), bindingGeneration: 2 });
    expect(fetcher.mock.calls.map((call) => bodyOf(call).invitation.epoch)).toEqual([3, 3, 0]);
    const floor = createEpochFloor();
    expect([floor("a", 1, 2), floor("a", 1, 1), floor("a", 1, 5), floor("a", 2, 0)]).toEqual([2, 2, 5, 0]);
  });

  it("caches a grant 30 s per (artifact, principal, invitation, session state), then asks again", async () => {
    let now = 1_000_000;
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never, now: () => now });
    await client.grant(ownerRequest());
    now += LIVE_GRANT_CACHE_MS - 1;
    await client.grant(ownerRequest());
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 1;
    await client.grant(ownerRequest());
    expect(fetcher).toHaveBeenCalledTimes(2);
    // A new session epoch is a new entry (revocation re-fences every route).
    await client.grant(ownerRequest(1, INVITE_EXP_MS));
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockImplementationOnce(async () => json(200, { grant: inviteeGrant() }));
    await client.grant(inviteeRequest());
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("never caches beyond 30 s even when asked to", async () => {
    let now = 0;
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never, now: () => now, cacheMs: 3_600_000 });
    await client.grant(ownerRequest());
    now = LIVE_GRANT_CACHE_MS;
    await client.grant(ownerRequest());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidates on demand (edge 404), on a 409 (stale_session, invalid_phase, stale_invitation) and on a 403", async () => {
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never });
    await client.grant(ownerRequest());
    client.invalidate(ARTIFACT, "alice");
    await client.grant(ownerRequest());
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const error of ["stale_session", "invalid_phase", "stale_invitation"] as const) {
      client.invalidate(ARTIFACT);
      await client.grant(ownerRequest());
      expect(client.size()).toBe(1);
      fetcher.mockImplementationOnce(async () => json(409, { error }));
      await expect(client.grant({ ...ownerRequest(), principalId: "alice2" })).resolves.toEqual({ kind: "conflict", error });
      expect(client.size()).toBe(0);
    }
    fetcher.mockImplementationOnce(async () => json(403, { error: "access_denied" }));
    await expect(client.grant(inviteeRequest())).resolves.toEqual({ kind: "denied" });
  });

  it("fails closed: unconfigured, token failure, transport error, other status, malformed or oversized answer", async () => {
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    await expect(createLiveGrantClient({ identity, fetch: fetcher as never }).grant(ownerRequest())).resolves.toEqual({ kind: "unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
    const broken = { authorization: async () => { throw new Error("idp down"); } };
    await expect(createLiveGrantClient({ baseUrl: BASE, identity: broken, fetch: fetcher as never }).grant(ownerRequest()))
      .resolves.toEqual({ kind: "unavailable" });
    for (const answer of [async () => { throw new Error("reset"); }, async () => json(500, {}), async () => json(404, {}),
      async () => json(200, { grant: ownerGrant({ podName: "artifact-forged" }) }),
      async () => json(200, { grant: ownerGrant({ principalId: "mallory" }) }),
      async () => json(200, { grant: ownerGrant({ podUid: "" }) }),
      async () => json(200, { grant: ownerGrant({ sourceRevision: "x".repeat(257) }) }),
      async () => json(200, { grant: ownerGrant(), padding: "x".repeat(70 * 1024) }),
      async () => json(409, { error: "other" }), async () => new Response("not json", { status: 200 })]) {
      const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: vi.fn(answer) as never });
      await expect(client.grant(ownerRequest())).resolves.toEqual({ kind: "unavailable" });
      expect(client.size()).toBe(0);
    }
  });

  it("binds the grant role and the invitee epoch to the request", () => {
    expect(parseLiveGrant(ownerGrant(), ownerRequest())).toEqual(ownerGrant());
    expect(parseLiveGrant(ownerGrant({ role: "invitee" }), ownerRequest())).toBeUndefined();
    // The owner's grant always carries invitationEpoch 0, whatever the session epoch.
    expect(parseLiveGrant(ownerGrant(), ownerRequest(4))).toEqual(ownerGrant());
    expect(parseLiveGrant(ownerGrant({ invitationEpoch: 4 }), ownerRequest(4))).toBeUndefined();
    expect(parseLiveGrant(inviteeGrant(), inviteeRequest())).toEqual(inviteeGrant());
    expect(parseLiveGrant({ ...inviteeGrant(), invitationId: "inv-2" }, inviteeRequest())).toBeUndefined();
    expect(parseLiveGrant(inviteeGrant(1), inviteeRequest(2))).toBeUndefined();
    expect(parseLiveGrant({ ...inviteeGrant(), invitationExp: Math.floor(INVITE_EXP_MS / 1000) + 1 }, inviteeRequest())).toBeUndefined();
    expect(parseLiveGrant({ ...inviteeGrant(), role: "binding_owner" }, inviteeRequest())).toBeUndefined();
    expect(parseLiveGrant(null, ownerRequest())).toBeUndefined();
  });
});

describe("live worker client (LiveWorkerPort over v1/live/reconcile and v1/live/stop)", () => {
  const id = { storageScopeId: SCOPE, artifactId: ARTIFACT, bindingGeneration: 2 };
  const fences = { current: vi.fn(async () => ({ liveSessionId: "sess-1", leaseEpoch: 4, routeEpoch: 3, ownerId: OWNER })) };
  const cleanDraft: LiveDraftSnapshot = { revision: "rev-7", baseHeadSha: HEAD, liveTreeSha: TREE, overlay: [] };
  const drafts = { current: vi.fn(async () => cleanDraft as LiveDraftSnapshot | undefined) };
  /** Draft endpoints answer 204; reconcile answers `reconcile`. */
  const routed = (reconcile: () => Response | Promise<Response> = () => json(200, ack)) => vi.fn(async (url: URL) =>
    String(url).includes("/draft/") ? new Response(null, { status: 204 }) : reconcile());
  const reconcileCall = (fetcher: { mock: { calls: unknown[][] } }) => fetcher.mock.calls.filter(([u]) => String(u).endsWith("/reconcile"));
  const sessionState = vi.fn(async (): Promise<LiveSessionInvitationState> => ({ epoch: 2, expiresAt: INVITE_EXP_MS }));
  const binding = { storageScopeId: SCOPE, artifactId: ARTIFACT, repoId: "radar-immobilier", branch: "artifact/p/alice000/triage-11111111",
    subPath: "", state: "attached", generation: 2 };
  const bindings = { get: vi.fn(async () => binding as never) };
  const ack = { liveSessionId: "sess-1", leaseEpoch: 4, routeEpoch: 3, revision: "rev-7", ready: true };

  it("reconciles with the package fences and the session invitation state, and returns the BridgeAck", async () => {
    const fetcher = routed();
    const worker = createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, drafts, bindings, fetch: fetcher as never });
    await expect(worker.reconcile(id)).resolves.toEqual(ack);
    const [url, init] = reconcileCall(fetcher)[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE}/v1/live/reconcile`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s2s-token");
    expect(bodyOf(reconcileCall(fetcher)[0]!)).toEqual({ artifactId: ARTIFACT, bindingGeneration: 2, ownerId: OWNER, liveSessionId: "sess-1",
      leaseEpoch: 4, routeEpoch: 3, binding: { repoId: "radar-immobilier", branch: binding.branch, subPath: "" },
      invitation: { epoch: 2, expiresAt: INVITE_EXP_MS } });
    expect(Object.keys(bodyOf(reconcileCall(fetcher)[0]!)).sort()).toEqual(["artifactId", "binding", "bindingGeneration", "invitation",
      "leaseEpoch", "liveSessionId", "ownerId", "routeEpoch"]);
    expect(Object.keys(bodyOf(reconcileCall(fetcher)[0]!).binding).sort()).toEqual(["branch", "repoId", "subPath"]);
    expect(bindings.get).toHaveBeenCalledWith(SCOPE, ARTIFACT);
    expect(sessionState).toHaveBeenCalledWith(id, "sess-1");
    // Never lowered on a later reconcile.
    sessionState.mockImplementationOnce(async () => ({ epoch: 1, expiresAt: null }));
    await worker.reconcile(id);
    expect(bodyOf(reconcileCall(fetcher)[1]!).invitation).toEqual({ epoch: 2, expiresAt: null });
  });

  it("fails closed with git_not_attached before any call without the binding of THAT generation", async () => {
    for (const record of [undefined, { ...binding, state: "detached" }, { ...binding, generation: 3 }, { ...binding, generation: 1 }]) {
      const fetcher = routed();
      const fenced = { current: vi.fn(fences.current) };
      const worker = createLiveWorkerClient({ baseUrl: BASE, identity, fences: fenced, sessionState, drafts,
        bindings: { get: async () => record as never }, fetch: fetcher as never });
      await expect(worker.reconcile(id)).rejects.toMatchObject({ kind: "git_not_attached" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(fenced.current).not.toHaveBeenCalled();
    }
    const fetcher = routed();
    await expect(createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, drafts, fetch: fetcher as never }).reconcile(id))
      .rejects.toMatchObject({ kind: "provider_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops with the session fences and requires 204", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const worker = createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, drafts, bindings, fetch: fetcher as never });
    await expect(worker.stop({ ...id, liveSessionId: "sess-1", leaseEpoch: 4 })).resolves.toBeUndefined();
    const [url] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE}/v1/live/stop`);
    expect(bodyOf(fetcher.mock.calls[0]!)).toEqual({ artifactId: ARTIFACT, bindingGeneration: 2, liveSessionId: "sess-1", leaseEpoch: 4 });
    const ok200 = createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, drafts, bindings, fetch: (async () => json(200, {})) as never });
    await expect(ok200.stop({ ...id, liveSessionId: "sess-1", leaseEpoch: 4 })).rejects.toMatchObject({ kind: "provider_unavailable" });
  });

  it("fails closed: unconfigured, no fences, non-200, malformed ack, transport error", async () => {
    await expect(createLiveWorkerClient({ identity, fences, sessionState, drafts }).reconcile(id)).rejects.toMatchObject({ kind: "builder_unavailable" });
    await expect(createLiveWorkerClient({ identity, fences, sessionState, drafts }).stop({ ...id, liveSessionId: "s", leaseEpoch: 1 }))
      .rejects.toMatchObject({ kind: "builder_unavailable" });
    const none = { current: async () => undefined };
    await expect(createLiveWorkerClient({ baseUrl: BASE, identity, fences: none, sessionState, drafts, bindings, fetch: routed() as never })
      .reconcile(id)).rejects.toMatchObject({ kind: "provider_unavailable" });
    for (const answer of [async () => json(409, { error: "stale_invitation" }), async () => json(200, { ...ack, ready: "yes" }),
      async () => json(200, { ...ack, revision: "" }), async () => { throw new Error("reset"); }]) {
      await expect(createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, drafts, bindings, fetch: routed(answer as never) as never }).reconcile(id))
        .rejects.toMatchObject({ kind: "provider_unavailable" });
    }
  });

  it("stages the draft (pages, then seal, then reconcile) with exact closed key sets", async () => {
    const draft: LiveDraftSnapshot = { revision: "rev-9", baseHeadSha: HEAD, liveTreeSha: TREE, overlay: [
      { path: "src/a.ts", text: "hello", mode: "100644" }, { path: "bin/run", text: "", mode: "100755" }, { path: "old.txt", text: null, mode: "100644" }] };
    const fetcher = routed();
    const worker = createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, bindings, fetch: fetcher as never,
      drafts: { current: async () => draft } });
    await worker.reconcile(id);
    expect(fetcher.mock.calls.map(([u]) => String(u).replace(BASE, ""))).toEqual(["/v1/live/draft/page", "/v1/live/draft/seal", "/v1/live/reconcile"]);
    const page = bodyOf(fetcher.mock.calls[0]!);
    expect(Object.keys(page).sort()).toEqual(["artifactId", "bindingGeneration", "files", "page", "revision"]);
    expect(page).toMatchObject({ artifactId: ARTIFACT, bindingGeneration: 2, revision: "rev-9", page: 0 });
    expect(page.files).toEqual([{ path: "src/a.ts", mode: 0o644, data: Buffer.from("hello").toString("base64") },
      { path: "bin/run", mode: 0o755, data: "" }]);
    expect(Object.keys(page.files[0]).sort()).toEqual(["data", "mode", "path"]);
    const seal = bodyOf(fetcher.mock.calls[1]!);
    expect(Object.keys(seal).sort()).toEqual(["artifactId", "baseHeadSha", "bindingGeneration", "deletes", "pages", "revision", "treeSha"]);
    expect(seal).toEqual({ artifactId: ARTIFACT, bindingGeneration: 2, revision: "rev-9", pages: 1, baseHeadSha: HEAD, treeSha: TREE,
      deletes: ["old.txt"] });
  });

  it("stages an empty overlay as pages 0 and no deletes, treeSha = liveTreeSha", async () => {
    const fetcher = routed();
    await createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, drafts, bindings, fetch: fetcher as never }).reconcile(id);
    expect(fetcher.mock.calls.map(([u]) => String(u).replace(BASE, ""))).toEqual(["/v1/live/draft/seal", "/v1/live/reconcile"]);
    expect(bodyOf(fetcher.mock.calls[0]!)).toEqual({ artifactId: ARTIFACT, bindingGeneration: 2, revision: "rev-7", pages: 0,
      baseHeadSha: HEAD, treeSha: TREE, deletes: [] });
  });

  it("pages within the host limits and refuses an overlay beyond them", () => {
    const mb = (n: number) => "x".repeat(n * 1024 * 1024);
    const snap = (overlay: LiveDraftSnapshot["overlay"]): LiveDraftSnapshot => ({ ...cleanDraft, overlay });
    // 1 MiB of file bytes per page: three 0.6 MiB files take three pages.
    const big = "y".repeat(600 * 1024);
    const plan = planDraft(snap([1, 2, 3].map((n) => ({ path: `f${n}`, text: big, mode: "100644" }))), id);
    expect(plan.pages.map((p) => p.files.length)).toEqual([1, 1, 1]);
    expect(plan.seal.pages).toBe(3);
    // 255 small files fit one page; 256 paths are refused.
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `d/${i}`, text: "z", mode: "100644" }));
    expect(planDraft(snap(many(255)), id).pages.map((p) => p.files.length)).toEqual([255]);
    expect(() => planDraft(snap(many(256)), id)).toThrow();
    expect(() => planDraft(snap([{ path: "a", text: mb(1) + "x", mode: "100644" }]), id)).toThrow();
    expect(() => planDraft(snap(Array.from({ length: 9 }, (_, i) => ({ path: `m${i}`, text: mb(1), mode: "100644" }))), id)).toThrow();
    expect(() => planDraft(snap([{ path: "a", text: "1", mode: "100644" }, { path: "a", text: null, mode: "100644" }]), id)).toThrow();
  });

  it("treats anything but 204 on a page or the seal as provider_unavailable, before reconcile", async () => {
    const draft: LiveDraftSnapshot = { ...cleanDraft, overlay: [{ path: "a", text: "1", mode: "100644" }] };
    for (const failing of ["/draft/page", "/draft/seal"]) {
      const fetcher = vi.fn(async (url: URL) => String(url).includes(failing) ? json(200, {}) : String(url).includes("/draft/")
        ? new Response(null, { status: 204 }) : json(200, ack));
      await expect(createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, bindings, fetch: fetcher as never,
        drafts: { current: async () => draft } }).reconcile(id)).rejects.toMatchObject({ kind: "provider_unavailable" });
      expect(fetcher.mock.calls.some(([u]) => String(u).endsWith("/reconcile"))).toBe(false);
    }
    const none = { current: async () => undefined };
    await expect(createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, bindings, drafts: none,
      fetch: routed() as never }).reconcile(id)).rejects.toMatchObject({ kind: "provider_unavailable" });
  });

  it("reads the fences from the package live store", async () => {
    const runtime = { ownerId: OWNER, liveSessionId: "sess-9", leaseEpoch: 5, routeEpoch: 2, phase: "LIVE" };
    const store = { transaction: vi.fn(async (_identity: unknown, action: (tx: unknown) => Promise<unknown>) =>
      action({ record: { runtime } })) };
    await expect(liveStoreFences(store as never).current(id)).resolves.toEqual({ ownerId: OWNER, liveSessionId: "sess-9", leaseEpoch: 5, routeEpoch: 2 });
    const empty = { transaction: async (_identity: unknown, action: (tx: unknown) => Promise<unknown>) => action({ record: undefined }) };
    await expect(liveStoreFences(empty as never).current(id)).resolves.toBeUndefined();
  });
});
