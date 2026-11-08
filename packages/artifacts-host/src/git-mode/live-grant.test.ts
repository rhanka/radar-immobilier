import { describe, expect, it, vi } from "vitest";
import {
  createEpochFloor, createLiveGrantClient, createLiveWorkerClient, LIVE_GRANT_CACHE_MS, livePodName, parseLiveGrant,
  type LiveGrant, type LiveGrantRequest,
} from "./live-grant.js";
import type { LiveSessionInvitationState } from "./live-authority.js";
import { liveStoreFences } from "./live.js";

const BASE = "https://preprod.sentropic.sent-tech.ca/api/v1/artifacts/builder";
const SCOPE = "radar-immobilier-preprod";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
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
  const fences = { current: vi.fn(async () => ({ liveSessionId: "sess-1", leaseEpoch: 4, routeEpoch: 3 })) };
  const sessionState = vi.fn(async (): Promise<LiveSessionInvitationState> => ({ epoch: 2, expiresAt: INVITE_EXP_MS }));
  const ack = { liveSessionId: "sess-1", leaseEpoch: 4, routeEpoch: 3, revision: "rev-7", ready: true };

  it("reconciles with the package fences and the session invitation state, and returns the BridgeAck", async () => {
    const fetcher = vi.fn(async () => json(200, ack));
    const worker = createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, fetch: fetcher as never });
    await expect(worker.reconcile(id)).resolves.toEqual(ack);
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE}/v1/live/reconcile`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s2s-token");
    expect(bodyOf(fetcher.mock.calls[0]!)).toEqual({ artifactId: ARTIFACT, bindingGeneration: 2, liveSessionId: "sess-1",
      leaseEpoch: 4, routeEpoch: 3, invitation: { epoch: 2, expiresAt: INVITE_EXP_MS } });
    expect(sessionState).toHaveBeenCalledWith(id, "sess-1");
    // Never lowered on a later reconcile.
    sessionState.mockImplementationOnce(async () => ({ epoch: 1, expiresAt: null }));
    await worker.reconcile(id);
    expect(bodyOf(fetcher.mock.calls[1]!).invitation).toEqual({ epoch: 2, expiresAt: null });
  });

  it("stops with the session fences and requires 204", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const worker = createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, fetch: fetcher as never });
    await expect(worker.stop({ ...id, liveSessionId: "sess-1", leaseEpoch: 4 })).resolves.toBeUndefined();
    const [url] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE}/v1/live/stop`);
    expect(bodyOf(fetcher.mock.calls[0]!)).toEqual({ artifactId: ARTIFACT, bindingGeneration: 2, liveSessionId: "sess-1", leaseEpoch: 4 });
    const ok200 = createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, fetch: (async () => json(200, {})) as never });
    await expect(ok200.stop({ ...id, liveSessionId: "sess-1", leaseEpoch: 4 })).rejects.toMatchObject({ kind: "provider_unavailable" });
  });

  it("fails closed: unconfigured, no fences, non-200, malformed ack, transport error", async () => {
    await expect(createLiveWorkerClient({ identity, fences, sessionState }).reconcile(id)).rejects.toMatchObject({ kind: "builder_unavailable" });
    await expect(createLiveWorkerClient({ identity, fences, sessionState }).stop({ ...id, liveSessionId: "s", leaseEpoch: 1 }))
      .rejects.toMatchObject({ kind: "builder_unavailable" });
    const none = { current: async () => undefined };
    await expect(createLiveWorkerClient({ baseUrl: BASE, identity, fences: none, sessionState, fetch: (async () => json(200, ack)) as never })
      .reconcile(id)).rejects.toMatchObject({ kind: "provider_unavailable" });
    for (const answer of [async () => json(409, { error: "stale_invitation" }), async () => json(200, { ...ack, ready: "yes" }),
      async () => json(200, { ...ack, revision: "" }), async () => { throw new Error("reset"); }]) {
      await expect(createLiveWorkerClient({ baseUrl: BASE, identity, fences, sessionState, fetch: vi.fn(answer) as never }).reconcile(id))
        .rejects.toMatchObject({ kind: "provider_unavailable" });
    }
  });

  it("reads the fences from the package live store", async () => {
    const runtime = { liveSessionId: "sess-9", leaseEpoch: 5, routeEpoch: 2, phase: "LIVE" };
    const store = { transaction: vi.fn(async (_identity: unknown, action: (tx: unknown) => Promise<unknown>) =>
      action({ record: { runtime } })) };
    await expect(liveStoreFences(store as never).current(id)).resolves.toEqual({ liveSessionId: "sess-9", leaseEpoch: 5, routeEpoch: 2 });
    const empty = { transaction: async (_identity: unknown, action: (tx: unknown) => Promise<unknown>) => action({ record: undefined }) };
    await expect(liveStoreFences(empty as never).current(id)).resolves.toBeUndefined();
  });
});
