import { describe, expect, it, vi } from "vitest";
import {
  createLiveGrantClient, createLiveWorkerClient, LIVE_GRANT_CACHE_MS, livePodName, parseLiveGrant, type LiveGrant,
} from "./live-grant.js";
import { liveStoreFences } from "./live.js";

const BASE = "https://preprod.sentropic.sent-tech.ca/api/v1/artifacts/builder";
const SCOPE = "radar-immobilier-preprod";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const identity = { authorization: vi.fn(async () => "Bearer s2s-token") };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status,
  headers: { "content-type": "application/json" } });

const ownerGrant = (over: Partial<LiveGrant> = {}): LiveGrant => ({ storageScopeId: SCOPE, artifactId: ARTIFACT, sessionId: "sess-1",
  generation: 1, routeEpoch: 3, podUid: "pod-uid-1", podName: livePodName(SCOPE, ARTIFACT), sourceRevision: "rev-7",
  principalId: "alice", role: "binding_owner", invitationId: "", invitationEpoch: 0, invitationExp: 0, ...over });
const INVITE_EXP_MS = Date.parse("2026-11-08T12:00:00.000Z");
const inviteeRequest = { artifactId: ARTIFACT, principalId: "carol", invitationEpoch: 1,
  invitation: { id: "inv-1", epoch: 1, expiresAt: INVITE_EXP_MS } };
const inviteeGrant = () => ownerGrant({ principalId: "carol", role: "invitee", invitationId: "inv-1", invitationEpoch: 1,
  invitationExp: Math.floor(INVITE_EXP_MS / 1000) });

describe("live grant client (POST v1/live/grant)", () => {
  it("sends the contract body with the S2S bearer and returns the parsed grant", async () => {
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never });
    await expect(client.grant({ artifactId: ARTIFACT, principalId: "alice", invitationEpoch: 0 }))
      .resolves.toEqual({ kind: "granted", grant: ownerGrant() });
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE}/v1/live/grant`);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s2s-token");
    expect(JSON.parse(String(init.body))).toEqual({ artifactId: ARTIFACT, access: "read", actor: { principalId: "alice" },
      invitationEpoch: 0 });
  });

  it("sends the invitee invitation (id, epoch, expiresAt in ms) and the immo epoch floor", async () => {
    const fetcher = vi.fn(async () => json(200, { grant: inviteeGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never });
    await expect(client.grant(inviteeRequest)).resolves.toMatchObject({ kind: "granted", grant: { role: "invitee" } });
    const [, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ artifactId: ARTIFACT, access: "read",
      actor: { principalId: "carol", invitation: { id: "inv-1", epoch: 1, expiresAt: INVITE_EXP_MS } }, invitationEpoch: 1 });
  });

  it("caches a grant 30 s per (artifact, principal, invitation), then asks again", async () => {
    let now = 1_000_000;
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never, now: () => now });
    const request = { artifactId: ARTIFACT, principalId: "alice", invitationEpoch: 0 };
    await client.grant(request);
    now += LIVE_GRANT_CACHE_MS - 1;
    await client.grant(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 1;
    await client.grant(request);
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Another principal or invitation is another entry.
    fetcher.mockImplementationOnce(async () => json(200, { grant: inviteeGrant() }));
    await client.grant(inviteeRequest);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(client.size()).toBe(2);
  });

  it("never caches beyond 30 s even when asked to", async () => {
    let now = 0;
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never, now: () => now, cacheMs: 3_600_000 });
    await client.grant({ artifactId: ARTIFACT, principalId: "alice", invitationEpoch: 0 });
    now = LIVE_GRANT_CACHE_MS;
    await client.grant({ artifactId: ARTIFACT, principalId: "alice", invitationEpoch: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("invalidates on demand (edge 404), on a 409 and on a 403", async () => {
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: fetcher as never });
    const request = { artifactId: ARTIFACT, principalId: "alice", invitationEpoch: 0 };
    await client.grant(request);
    client.invalidate(ARTIFACT, "alice");
    await client.grant(request);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockImplementationOnce(async () => json(409, { error: "stale_session" }));
    client.invalidate(ARTIFACT);
    await expect(client.grant(request)).resolves.toEqual({ kind: "conflict", error: "stale_session" });
    expect(client.size()).toBe(0);
    await client.grant(request);
    expect(client.size()).toBe(1);
    fetcher.mockImplementationOnce(async () => json(409, { error: "invalid_phase" }));
    await expect(client.grant({ ...request, invitationEpoch: 0, principalId: "alice2" }))
      .resolves.toEqual({ kind: "conflict", error: "invalid_phase" });
    expect(client.size()).toBe(0);
    fetcher.mockImplementationOnce(async () => json(403, { error: "access_denied" }));
    await expect(client.grant(inviteeRequest)).resolves.toEqual({ kind: "denied" });
    client.invalidateInvitation(ARTIFACT, "inv-1");
  });

  it("fails closed: unconfigured, token failure, transport error, other status, malformed grant", async () => {
    const fetcher = vi.fn(async () => json(200, { grant: ownerGrant() }));
    const request = { artifactId: ARTIFACT, principalId: "alice", invitationEpoch: 0 };
    await expect(createLiveGrantClient({ identity, fetch: fetcher as never }).grant(request)).resolves.toEqual({ kind: "unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
    const broken = { authorization: async () => { throw new Error("idp down"); } };
    await expect(createLiveGrantClient({ baseUrl: BASE, identity: broken, fetch: fetcher as never }).grant(request))
      .resolves.toEqual({ kind: "unavailable" });
    for (const answer of [async () => { throw new Error("reset"); }, async () => json(500, {}), async () => json(404, {}),
      async () => json(200, { grant: ownerGrant({ podName: "artifact-forged" }) }),
      async () => json(200, { grant: ownerGrant({ principalId: "mallory" }) }),
      async () => json(200, { grant: ownerGrant({ podUid: "" }) }),
      async () => json(200, { grant: ownerGrant({ sourceRevision: "x".repeat(257) }) }),
      async () => json(409, { error: "other" }), async () => new Response("not json", { status: 200 })]) {
      const client = createLiveGrantClient({ baseUrl: BASE, identity, fetch: vi.fn(answer) as never });
      await expect(client.grant(request)).resolves.toEqual({ kind: "unavailable" });
      expect(client.size()).toBe(0);
    }
  });

  it("binds the grant role to the request", () => {
    const owner = { artifactId: ARTIFACT, principalId: "alice", invitationEpoch: 0 };
    expect(parseLiveGrant(ownerGrant(), owner)).toEqual(ownerGrant());
    expect(parseLiveGrant(ownerGrant({ role: "invitee" }), owner)).toBeUndefined();
    expect(parseLiveGrant(ownerGrant({ invitationEpoch: 1 }), owner)).toBeUndefined();
    expect(parseLiveGrant(inviteeGrant(), inviteeRequest)).toEqual(inviteeGrant());
    expect(parseLiveGrant({ ...inviteeGrant(), invitationId: "inv-2" }, inviteeRequest)).toBeUndefined();
    expect(parseLiveGrant({ ...inviteeGrant(), invitationEpoch: 2 }, inviteeRequest)).toBeUndefined();
    expect(parseLiveGrant({ ...inviteeGrant(), invitationExp: Math.floor(INVITE_EXP_MS / 1000) + 1 }, inviteeRequest)).toBeUndefined();
    expect(parseLiveGrant({ ...inviteeGrant(), role: "binding_owner" }, inviteeRequest)).toBeUndefined();
    expect(parseLiveGrant(null, owner)).toBeUndefined();
  });
});

describe("live worker client (LiveWorkerPort over v1/live/reconcile and v1/live/stop)", () => {
  const id = { storageScopeId: SCOPE, artifactId: ARTIFACT, bindingGeneration: 2 };
  const fences = { current: vi.fn(async () => ({ liveSessionId: "sess-1", leaseEpoch: 4, routeEpoch: 3 })) };
  const ack = { liveSessionId: "sess-1", leaseEpoch: 4, routeEpoch: 3, revision: "rev-7", ready: true };

  it("reconciles with the package fences and returns the BridgeAck", async () => {
    const fetcher = vi.fn(async () => json(200, ack));
    const worker = createLiveWorkerClient({ baseUrl: BASE, identity, fences, fetch: fetcher as never });
    await expect(worker.reconcile(id)).resolves.toEqual(ack);
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE}/v1/live/reconcile`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer s2s-token");
    expect(JSON.parse(String(init.body))).toEqual({ artifactId: ARTIFACT, bindingGeneration: 2, liveSessionId: "sess-1",
      leaseEpoch: 4, routeEpoch: 3 });
  });

  it("stops with the session fences and requires 204", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const worker = createLiveWorkerClient({ baseUrl: BASE, identity, fences, fetch: fetcher as never });
    await expect(worker.stop({ ...id, liveSessionId: "sess-1", leaseEpoch: 4 })).resolves.toBeUndefined();
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${BASE}/v1/live/stop`);
    expect(JSON.parse(String(init.body))).toEqual({ artifactId: ARTIFACT, bindingGeneration: 2, liveSessionId: "sess-1", leaseEpoch: 4 });
    const ok200 = createLiveWorkerClient({ baseUrl: BASE, identity, fences, fetch: (async () => json(200, {})) as never });
    await expect(ok200.stop({ ...id, liveSessionId: "sess-1", leaseEpoch: 4 })).rejects.toMatchObject({ kind: "provider_unavailable" });
  });

  it("fails closed: unconfigured, no fences, non-200, malformed ack, transport error", async () => {
    await expect(createLiveWorkerClient({ identity, fences }).reconcile(id)).rejects.toMatchObject({ kind: "builder_unavailable" });
    await expect(createLiveWorkerClient({ identity, fences }).stop({ ...id, liveSessionId: "s", leaseEpoch: 1 }))
      .rejects.toMatchObject({ kind: "builder_unavailable" });
    const none = { current: async () => undefined };
    await expect(createLiveWorkerClient({ baseUrl: BASE, identity, fences: none, fetch: (async () => json(200, ack)) as never })
      .reconcile(id)).rejects.toMatchObject({ kind: "provider_unavailable" });
    for (const answer of [async () => json(409, { error: "stale_session" }), async () => json(200, { ...ack, ready: "yes" }),
      async () => json(200, { ...ack, revision: "" }), async () => { throw new Error("reset"); }]) {
      await expect(createLiveWorkerClient({ baseUrl: BASE, identity, fences, fetch: vi.fn(answer) as never }).reconcile(id))
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
