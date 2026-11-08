import { createMemoryGitBindingStore, type GitBinding, type GitBindingStore } from "@sentropic/artifacts";
import { signLiveAssertion, verifyLiveAssertion } from "@sentropic/artifacts/live-host";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createLiveReaderGate } from "./live-authority.js";
import {
  admitLive, composeLiveEdgePorts, grantRequestFor, liveAssertionFromGrant, LIVE_HTTP_ASSERTION_SECONDS,
  LIVE_WS_ASSERTION_SECONDS, readLiveEdgeEnabled, readLiveEdgeForward, type LiveReadinessPort,
} from "./live-forward.js";
import { createLiveGrantClient, livePodName, NO_LIVE_INVITATIONS, type LiveGrant } from "./live-grant.js";
import { createImmoGitRegistry, IMMO_GIT_REPO_ID } from "./registry.js";

const SCOPE = "radar-immobilier-preprod";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const DOMAIN = "pages.preprod.immo.sent-tech.ca";
const HOST = `${ARTIFACT}.${DOMAIN}`;
const KID = "immo-preprod-live-1";
const KEY = new Uint8Array(32).fill(7);
const NOW = Date.parse("2026-11-08T12:00:00.000Z");
/** Package live session (user-visible) and the controller grant session (new on every revive or crash restore). */
const SESSION = "sess-1";
const CTL = "ctl-1";

const binding: GitBinding = { artifactId: ARTIFACT, storageScopeId: SCOPE, repoId: IMMO_GIT_REPO_ID,
  branch: "artifact/p/alice000/triage-11111111", channel: "personal", personalPrincipalId: "alice", subPath: "",
  baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40), releaseCommitSha: null, autoPublish: true, executor: "sandbox",
  pendingJobId: null, pendingCommitSha: null, state: "attached", generation: 1, version: 1, attachedBy: "alice",
  attachedAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() };

let bindings: GitBindingStore;
let readiness: { revision: string; ready: boolean; liveSessionId?: string; ownerId?: string } | undefined;
let grantOver: Partial<LiveGrant>;
let fetcher: Mock<(url: URL, init: RequestInit) => Promise<Response>>;
const bodies = () => fetcher.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as {
  actor: { principalId: string; invitation?: unknown }; invitation: { epoch: number; expiresAt: number | null } });

const codeRights = { canReadCode: async ({ actorId }: { actorId: string }) => ["alice", "carol"].includes(actorId) };
const registry = createImmoGitRegistry({ storageScopeId: SCOPE, installationRef: "inst" });

function ports(consent: (principalId: string) => boolean = () => true) {
  const readinessPort: LiveReadinessPort = { current: async () => readiness };
  const grants = createLiveGrantClient({ baseUrl: "https://builder.test/api/v1/artifacts/builder",
    identity: { authorization: async () => "Bearer t" }, fetch: fetcher as never, now: () => NOW });
  return { storageScopeId: SCOPE, readiness: readinessPort, grants, gate: createLiveReaderGate({ bindings, registry, codeRights }),
    consent: async (principalId: string) => consent(principalId) };
}
const admit = (principalId: string, p = ports(), lifetimeSeconds = LIVE_HTTP_ASSERTION_SECONDS) =>
  admitLive(p, { host: HOST, artifactId: ARTIFACT, principalId, kid: KID, nowMs: NOW, lifetimeSeconds });

beforeEach(async () => {
  bindings = createMemoryGitBindingStore();
  await bindings.write({ binding, expectedVersion: null, actorId: "alice", idempotencyKey: "k", commandHash: "h", event: { action: "attach" } });
  readiness = { revision: "rev-7", ready: true, liveSessionId: SESSION, ownerId: "alice" };
  grantOver = {};
  // Fake controller: grants the owner at the current revision, with its own (controller) session id.
  fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { actor: { principalId: string } };
    const grant: LiveGrant = { storageScopeId: SCOPE, artifactId: ARTIFACT, sessionId: CTL, generation: 1, routeEpoch: 2,
      podUid: "pod-uid-1", podName: livePodName(SCOPE, ARTIFACT), sourceRevision: "rev-7", principalId: body.actor.principalId,
      role: "binding_owner", invitationId: "", invitationEpoch: 0, invitationExp: 0, ...grantOver };
    return new Response(JSON.stringify({ grant }), { status: 200 });
  });
});

describe("live edge flags (default off)", () => {
  const env = { IMMO_ARTIFACTS_LIVE_EDGE_ENABLED: "1", IMMO_ARTIFACTS_LIVE_HOST_KEYS: `${KID}=${Buffer.from(KEY).toString("base64url")}`,
    IMMO_ARTIFACTS_LIVE_HOST_KID: KID, IMMO_ARTIFACTS_LIVE_HOST: DOMAIN,
    IMMO_ARTIFACTS_LIVE_EDGE_URL: "http://artifact-content.sentropic-preprod.svc.cluster.local:8791" };

  it("is off unless stage live AND the flag is exactly 1", () => {
    expect(readLiveEdgeEnabled({}, "live")).toBe(false);
    expect(readLiveEdgeEnabled({ IMMO_ARTIFACTS_LIVE_EDGE_ENABLED: "true" }, "live")).toBe(false);
    expect(readLiveEdgeEnabled({ IMMO_ARTIFACTS_LIVE_EDGE_ENABLED: "1" }, "build")).toBe(false);
    expect(readLiveEdgeEnabled({ IMMO_ARTIFACTS_LIVE_EDGE_ENABLED: "1" }, "live")).toBe(true);
    expect(readLiveEdgeForward({ ...env, IMMO_ARTIFACTS_LIVE_EDGE_ENABLED: "0" }, "live", DOMAIN)).toEqual({ enabled: false });
    expect(composeLiveEdgePorts({ pool: {} as never, storageScopeId: SCOPE, env: {}, stage: "live", contentBase: DOMAIN,
      module: undefined })).toBeUndefined();
  });

  it("reads the forward configuration, or an unavailable state without throwing", () => {
    const on = readLiveEdgeForward(env, "live", DOMAIN);
    expect(on).toMatchObject({ enabled: true, config: { kid: KID } });
    expect(String((on as { config: { target: URL } }).config.target)).toBe("http://artifact-content.sentropic-preprod.svc.cluster.local:8791/");
    expect(readLiveEdgeForward({ ...env, IMMO_ARTIFACTS_LIVE_EDGE_URL: "" }, "live", DOMAIN)).toEqual({ enabled: true, reason: "live_edge_url_missing" });
    expect(readLiveEdgeForward({ ...env, IMMO_ARTIFACTS_LIVE_EDGE_URL: "http://x:1/path" }, "live", DOMAIN))
      .toEqual({ enabled: true, reason: "live_edge_config_invalid" });
    expect(readLiveEdgeForward({ ...env, IMMO_ARTIFACTS_LIVE_HOST_KID: "" }, "live", DOMAIN)).toEqual({ enabled: true, reason: "live_edge_key_missing" });
    expect(readLiveEdgeForward(env, "live", "pages.other.test")).toEqual({ enabled: true, reason: "live_edge_host_mismatch" });
  });
});

describe("§8.2 gate, owner-only until the generic invitations (0.2.22)", () => {
  it("admits the binding owner, also runtime owner, with code rights and consent; sends no invitation", async () => {
    expect(await admit("alice")).toMatchObject({ kind: "live", liveSessionId: SESSION,
      claims: { role: "binding_owner", principalId: "alice", invitationId: "", invitationEpoch: 0, invitationExp: 0 } });
    expect(bodies()).toEqual([{ artifactId: ARTIFACT, access: "read", actor: { principalId: "alice" }, invitation: NO_LIVE_INVITATIONS }]);
  });

  it("refuses an invitee or any other principal, without consent, without code rights, or when not the runtime owner", async () => {
    // carol holds code rights but is not the owner: refused (TODO(0.2.22): liveViewer).
    expect(await admit("carol")).toEqual({ kind: "none" });
    expect(await admit("mallory")).toEqual({ kind: "none" });
    expect(await admit("alice", ports(() => false))).toEqual({ kind: "none" });
    readiness = { revision: "rev-7", ready: true, liveSessionId: SESSION, ownerId: "carol" };
    expect(await admit("alice")).toEqual({ kind: "none" });
    expect(fetcher).not.toHaveBeenCalled();
    const noRights = { ...ports(), gate: createLiveReaderGate({ bindings, registry, codeRights: { canReadCode: async () => false } }) };
    expect(await admit("alice", noRights)).toEqual({ kind: "none" });
  });

  it("stays live across a controller crash restore: the new grant.sessionId is carried as is", async () => {
    expect(await admit("alice")).toMatchObject({ kind: "live", claims: { sessionId: CTL }, liveSessionId: SESSION });
    grantOver = { sessionId: "ctl-restored" };
    expect(await admit("alice", ports())).toMatchObject({ kind: "live", claims: { sessionId: "ctl-restored" }, liveSessionId: SESSION });
  });

  it("follows a generation change and refuses a grant of another generation", async () => {
    const before = (await bindings.get(SCOPE, ARTIFACT))!;
    await bindings.write({ binding: { ...before, state: "paused", generation: 2, version: 2 }, expectedVersion: 1, actorId: "alice",
      idempotencyKey: "regen", commandHash: "h2", event: { action: "pause" } });
    expect(await admit("alice")).toEqual({ kind: "release", reason: "grant_mismatch" });
    grantOver = { generation: 2 };
    expect(await admit("alice")).toMatchObject({ kind: "live", claims: { generation: 2 } });
  });
});

describe("live or release: readiness and grant revision", () => {
  it("serves the release while the live record is not ready, without asking the controller", async () => {
    readiness = { revision: "rev-7", ready: false, liveSessionId: SESSION };
    expect(await admit("alice")).toEqual({ kind: "release", reason: "not_ready" });
    readiness = undefined;
    expect(await admit("alice")).toEqual({ kind: "release", reason: "not_ready" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("serves the release when the grant names another revision, scope, generation or role", async () => {
    for (const over of [{ sourceRevision: "rev-6" }, { storageScopeId: "other-scope", podName: livePodName("other-scope", ARTIFACT) },
      { generation: 2 }] as Partial<LiveGrant>[]) {
      grantOver = over;
      const p = ports();
      expect(await admit("alice", p)).toEqual({ kind: "release", reason: "grant_mismatch" });
      expect(p.grants.size()).toBe(0);
    }
  });

  it("serves the release on a refused or unavailable grant", async () => {
    for (const [status, error, reason] of [[409, "invalid_phase", "grant_invalid_phase"], [409, "stale_session", "grant_stale_session"],
      [409, "stale_invitation", "grant_stale_invitation"], [403, "access_denied", "grant_denied"]] as const) {
      fetcher.mockImplementation(async () => new Response(JSON.stringify({ error }), { status }));
      expect(await admit("alice")).toEqual({ kind: "release", reason });
    }
    fetcher.mockImplementation(async () => { throw new Error("ECONNREFUSED"); });
    expect(await admit("alice")).toEqual({ kind: "release", reason: "grant_unavailable" });
  });
});

describe("x-live-host-assertion (grant signed unchanged + v, kid, host, iat, exp)", () => {
  const verify = (token: string) => verifyLiveAssertion(token, { key: (kid) => kid === KID ? KEY : undefined, now: () => NOW });

  it("is verifiable with the provider verifier and carries exactly the 18 closed claims", async () => {
    const admission = await admit("alice");
    if (admission.kind !== "live") throw new Error("expected live");
    const claims = verify(signLiveAssertion(admission.claims, KEY));
    expect(claims).toBeDefined();
    expect(Object.keys(claims!).sort()).toEqual(["artifactId", "exp", "generation", "host", "iat", "invitationEpoch", "invitationExp",
      "invitationId", "kid", "podName", "podUid", "principalId", "role", "routeEpoch", "sessionId", "sourceRevision", "storageScopeId",
      "v"]);
    const { v, kid, host, iat, exp, ...grant } = claims!;
    expect({ v, kid, host, exp: exp - iat }).toEqual({ v: 1, kid: KID, host: HOST, exp: 60 });
    expect(grant).toEqual(admission.grant);
    expect(iat).toBe(Math.floor(NOW / 1000));
  });

  it("gives the websocket assertion 3600 s for the owner", async () => {
    const admission = await admit("alice", ports(), LIVE_WS_ASSERTION_SECONDS);
    if (admission.kind !== "live") throw new Error("expected live");
    expect(admission.claims.exp - admission.claims.iat).toBe(3600);
  });

  it("caps an invitee assertion at the invitation expiry and drops extra grant fields (for 0.2.22)", () => {
    const base: LiveGrant = { storageScopeId: SCOPE, artifactId: ARTIFACT, sessionId: CTL, generation: 1, routeEpoch: 2,
      podUid: "pod-uid-1", podName: livePodName(SCOPE, ARTIFACT), sourceRevision: "rev-7", principalId: "carol", role: "invitee",
      invitationId: "inv-1", invitationEpoch: 1, invitationExp: Math.floor(NOW / 1000) + 600 };
    expect(liveAssertionFromGrant({ grant: base, kid: KID, host: HOST, nowMs: NOW, lifetimeSeconds: 3600 })!.exp).toBe(base.invitationExp);
    expect(liveAssertionFromGrant({ grant: { ...base, invitationExp: Math.floor(NOW / 1000) }, kid: KID, host: HOST, nowMs: NOW,
      lifetimeSeconds: 60 })).toBeUndefined();
    const extra = { ...base, extra: "x" } as LiveGrant;
    const claims = liveAssertionFromGrant({ grant: extra, kid: KID, host: HOST.toUpperCase(), nowMs: NOW, lifetimeSeconds: 60 })!;
    expect(Object.keys(claims)).not.toContain("extra");
    expect(claims.host).toBe(HOST);
  });

  it("builds the owner grant request with the session state", () => {
    expect(grantRequestFor(ARTIFACT, { role: "binding_owner", principalId: "alice", bindingGeneration: 1 }, NO_LIVE_INVITATIONS))
      .toEqual({ artifactId: ARTIFACT, bindingGeneration: 1, principalId: "alice", session: NO_LIVE_INVITATIONS });
  });
});
