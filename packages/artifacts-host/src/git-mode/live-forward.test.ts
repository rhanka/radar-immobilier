import { createMemoryGitBindingStore, type GitBinding, type GitBindingStore } from "@sentropic/artifacts";
import { signLiveAssertion, verifyLiveAssertion } from "@sentropic/artifacts/live-host";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createLiveInvitationService, createLiveReaderGate, createMemoryLiveInvitationStore, type LiveInvitationStore } from "./live-authority.js";
import {
  admitLive, composeLiveEdgePorts, grantRequestFor, liveAssertionFromGrant, LIVE_HTTP_ASSERTION_SECONDS,
  LIVE_WS_ASSERTION_SECONDS, readLiveEdgeEnabled, readLiveEdgeForward, type LiveReadinessPort,
} from "./live-forward.js";
import { createLiveGrantClient, livePodName, type LiveGrant, type LiveGrantRequest } from "./live-grant.js";
import { createImmoGitRegistry, IMMO_GIT_REPO_ID } from "./registry.js";

const SCOPE = "radar-immobilier-preprod";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const DOMAIN = "pages.preprod.immo.sent-tech.ca";
const HOST = `${ARTIFACT}.${DOMAIN}`;
const KID = "immo-preprod-live-1";
const KEY = new Uint8Array(32).fill(7);
const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const SESSION = "sess-1";

const binding: GitBinding = { artifactId: ARTIFACT, storageScopeId: SCOPE, repoId: IMMO_GIT_REPO_ID,
  branch: "artifact/p/alice000/triage-11111111", channel: "personal", personalPrincipalId: "alice", subPath: "",
  baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40), releaseCommitSha: null, autoPublish: true, executor: "sandbox",
  pendingJobId: null, pendingCommitSha: null, state: "attached", generation: 1, version: 1, attachedBy: "alice",
  attachedAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() };

const grantFor = (request: LiveGrantRequest, over: Partial<LiveGrant> = {}): LiveGrant => ({ storageScopeId: SCOPE,
  artifactId: ARTIFACT, sessionId: SESSION, generation: 1, routeEpoch: 2, podUid: "pod-uid-1", podName: livePodName(SCOPE, ARTIFACT),
  sourceRevision: "rev-7", principalId: request.principalId, role: request.invitation ? "invitee" : "binding_owner",
  invitationId: request.invitation?.id ?? "", invitationEpoch: request.invitation ? request.invitationEpoch : 0,
  invitationExp: request.invitation ? Math.floor(request.invitation.expiresAt / 1000) : 0, ...over });

let bindings: GitBindingStore;
let invitations: LiveInvitationStore;
let readiness: { revision: string; ready: boolean } | undefined;
let grantOver: Partial<LiveGrant>;
let fetcher: Mock<(url: URL, init: RequestInit) => Promise<Response>>;

const codeRights = { canReadCode: async ({ actorId }: { actorId: string }) => ["alice", "carol", "dave"].includes(actorId) };
const sessions = { current: async () => ({ liveSessionId: SESSION }) };
const registry = createImmoGitRegistry({ storageScopeId: SCOPE, installationRef: "inst" });

function ports(consent: (principalId: string) => boolean = () => true) {
  const readinessPort: LiveReadinessPort = { current: async () => readiness };
  const grants = createLiveGrantClient({ baseUrl: "https://builder.test/api/v1/artifacts/builder",
    identity: { authorization: async () => "Bearer t" }, fetch: fetcher as never, now: () => NOW });
  return { storageScopeId: SCOPE, readiness: readinessPort, grants,
    gate: createLiveReaderGate({ bindings, registry, codeRights, invitations, sessions, now: () => NOW }),
    consent: async (principalId: string) => consent(principalId) };
}
const admit = (principalId: string, p = ports(), lifetimeSeconds = LIVE_HTTP_ASSERTION_SECONDS) =>
  admitLive(p, { host: HOST, artifactId: ARTIFACT, principalId, kid: KID, nowMs: NOW, lifetimeSeconds });
const invite = async (inviteeId: string) => createLiveInvitationService({ bindings, registry, codeRights, invitations, sessions,
  now: () => NOW }).create({ actorId: "alice", storageScopeId: SCOPE, scopes: ["immo:artifacts:read", "immo:artifacts:write"] },
  { artifactId: ARTIFACT, inviteeId });

beforeEach(async () => {
  bindings = createMemoryGitBindingStore();
  invitations = createMemoryLiveInvitationStore();
  await bindings.write({ binding, expectedVersion: null, actorId: "alice", idempotencyKey: "k", commandHash: "h", event: { action: "attach" } });
  readiness = { revision: "rev-7", ready: true };
  grantOver = {};
  // Fake controller: grants exactly what was asked, at the current revision (overridable).
  fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { artifactId: string; invitationEpoch: number;
      actor: { principalId: string; invitation?: LiveGrantRequest["invitation"] } };
    const request: LiveGrantRequest = { artifactId: body.artifactId, principalId: body.actor.principalId,
      invitationEpoch: body.invitationEpoch, ...(body.actor.invitation ? { invitation: body.actor.invitation } : {}) };
    return new Response(JSON.stringify({ grant: grantFor(request, grantOver) }), { status: 200 });
  });
});

describe("live edge flag (IMMO_ARTIFACTS_LIVE_EDGE_ENABLED, default off)", () => {
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

describe("§8.2 gate matrix before any controller call", () => {
  it("admits the binding owner and an active invitee; refuses a revoked invitee and a stranger", async () => {
    expect(await admit("alice")).toMatchObject({ kind: "live", claims: { role: "binding_owner", principalId: "alice" } });
    const invitation = await invite("carol");
    expect(await admit("carol")).toMatchObject({ kind: "live", claims: { role: "invitee", principalId: "carol",
      invitationId: invitation.invitationId, invitationEpoch: 1 } });
    await invitations.revoke(SCOPE, ARTIFACT, invitation.invitationId, new Date(NOW).toISOString());
    const calls = fetcher.mock.calls.length;
    expect(await admit("carol")).toEqual({ kind: "none" });
    // Code rights without an invitation, or no code rights at all.
    expect(await admit("dave")).toEqual({ kind: "none" });
    expect(await admit("mallory")).toEqual({ kind: "none" });
    expect(fetcher.mock.calls.length).toBe(calls);
  });

  it("refuses a gated principal without a live reader consent", async () => {
    expect(await admit("alice", ports(() => false))).toEqual({ kind: "none" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("live or release: readiness and grant revision", () => {
  it("serves the release while the live record is not ready, without asking the controller", async () => {
    readiness = { revision: "rev-7", ready: false };
    expect(await admit("alice")).toEqual({ kind: "release", reason: "not_ready" });
    readiness = undefined;
    expect(await admit("alice")).toEqual({ kind: "release", reason: "not_ready" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("serves the release when the grant names another revision, and drops it from the cache", async () => {
    grantOver = { sourceRevision: "rev-6" };
    const p = ports();
    expect(await admit("alice", p)).toEqual({ kind: "release", reason: "grant_mismatch" });
    expect(p.grants.size()).toBe(0);
    grantOver = { storageScopeId: "other-scope", podName: livePodName("other-scope", ARTIFACT) };
    expect(await admit("alice", ports())).toEqual({ kind: "release", reason: "grant_mismatch" });
    grantOver = { generation: 2 };
    expect(await admit("alice", ports())).toEqual({ kind: "release", reason: "grant_mismatch" });
  });

  it("serves the release on a refused or unavailable grant", async () => {
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: "invalid_phase" }), { status: 409 }));
    expect(await admit("alice")).toEqual({ kind: "release", reason: "grant_invalid_phase" });
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: "access_denied" }), { status: 403 }));
    expect(await admit("alice")).toEqual({ kind: "release", reason: "grant_denied" });
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

  it("caps an invitee websocket assertion at the invitation expiry", async () => {
    await invite("carol");
    const admission = await admit("carol", ports(), LIVE_WS_ASSERTION_SECONDS);
    if (admission.kind !== "live") throw new Error("expected live");
    const claims = verify(signLiveAssertion(admission.claims, KEY))!;
    expect(claims.exp).toBe(Math.min(Math.floor(NOW / 1000) + 3600, claims.invitationExp));
    const owner = await admit("alice", ports(), LIVE_WS_ASSERTION_SECONDS);
    if (owner.kind !== "live") throw new Error("expected live");
    expect(owner.claims.exp - owner.claims.iat).toBe(3600);
  });

  it("drops extra grant fields and refuses an expired invitation", () => {
    const request = { artifactId: ARTIFACT, principalId: "carol", invitationEpoch: 1,
      invitation: { id: "inv-1", epoch: 1, expiresAt: NOW } };
    expect(liveAssertionFromGrant({ grant: grantFor(request), kid: KID, host: HOST, nowMs: NOW, lifetimeSeconds: 60 })).toBeUndefined();
    const extra = { ...grantFor({ artifactId: ARTIFACT, principalId: "alice", invitationEpoch: 0 }), extra: "x" } as LiveGrant;
    const claims = liveAssertionFromGrant({ grant: extra, kid: KID, host: HOST.toUpperCase(), nowMs: NOW, lifetimeSeconds: 60 })!;
    expect(Object.keys(claims)).not.toContain("extra");
    expect(claims.host).toBe(HOST);
  });

  it("builds the grant request from the gate role (invitation epoch floor from immo's store)", () => {
    expect(grantRequestFor(ARTIFACT, { role: "binding_owner", principalId: "alice", bindingGeneration: 1 }))
      .toEqual({ artifactId: ARTIFACT, principalId: "alice", invitationEpoch: 0 });
    expect(grantRequestFor(ARTIFACT, { role: "invitee", principalId: "carol", bindingGeneration: 1, invitationId: "inv-1", epoch: 3,
      expiresAt: new Date(NOW).toISOString(), liveSessionId: SESSION }))
      .toEqual({ artifactId: ARTIFACT, principalId: "carol", invitationEpoch: 3, invitation: { id: "inv-1", epoch: 3, expiresAt: NOW } });
  });
});
