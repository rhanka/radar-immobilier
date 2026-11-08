import { createMemoryGitBindingStore, type GitBinding, type GitBindingStore } from "@sentropic/artifacts";
import { signLiveAssertion, verifyLiveAssertion } from "@sentropic/artifacts/live-host";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createLiveInvitationService, createLiveReaderGate, createLiveSessionStatePort, createMemoryLiveInvitationStore,
  type LiveInvitationStore,
} from "./live-authority.js";
import { createMemoryLiveAuthorizationStore } from "./live-authorizations.js";
import {
  acceptLiveInvitation, admitLive, composeLiveEdgePorts, grantRequestFor, liveAssertionFromGrant, LIVE_HTTP_ASSERTION_SECONDS,
  LIVE_WS_ASSERTION_SECONDS, readLiveEdgeEnabled, readLiveEdgeForward, type LiveReadinessPort,
} from "./live-forward.js";
import { createLiveGrantClient, livePodName, type LiveGrant } from "./live-grant.js";
import { createImmoGitRegistry, IMMO_GIT_REPO_ID } from "./registry.js";

const SCOPE = "radar-immobilier-preprod";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const DOMAIN = "pages.preprod.immo.sent-tech.ca";
const HOST = `${ARTIFACT}.${DOMAIN}`;
const KID = "immo-preprod-live-1";
const KEY = new Uint8Array(32).fill(7);
const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const SESSION = "sess-1";
const OWNER_SCOPES = ["immo:artifacts:read", "immo:artifacts:write"];

const binding: GitBinding = { artifactId: ARTIFACT, storageScopeId: SCOPE, repoId: IMMO_GIT_REPO_ID,
  branch: "artifact/p/alice000/triage-11111111", channel: "personal", personalPrincipalId: "alice", subPath: "",
  baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40), releaseCommitSha: null, autoPublish: true, executor: "sandbox",
  pendingJobId: null, pendingCommitSha: null, state: "attached", generation: 1, version: 1, attachedBy: "alice",
  attachedAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() };

let bindings: GitBindingStore;
let invitations: LiveInvitationStore;
let authorizations: ReturnType<typeof createMemoryLiveAuthorizationStore>;
let readiness: { revision: string; ready: boolean; liveSessionId?: string } | undefined;
let grantOver: Partial<LiveGrant>;
let invitationsOn: boolean;
let fetcher: Mock<(url: URL, init: RequestInit) => Promise<Response>>;
const bodies = () => fetcher.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as {
  actor: { principalId: string; invitation?: { id: string; epoch: number; expiresAt: number } };
  invitation: { epoch: number; expiresAt: number | null } });

const codeRights = { canReadCode: async ({ actorId }: { actorId: string }) => ["alice", "carol", "dave", "erin"].includes(actorId) };
const sessions = { current: async () => ({ liveSessionId: SESSION }) };
const registry = createImmoGitRegistry({ storageScopeId: SCOPE, installationRef: "inst" });
const flag = () => invitationsOn;

function ports(consent: (principalId: string) => boolean = () => true) {
  const readinessPort: LiveReadinessPort = { current: async () => readiness };
  const grants = createLiveGrantClient({ baseUrl: "https://builder.test/api/v1/artifacts/builder",
    identity: { authorization: async () => "Bearer t" }, fetch: fetcher as never, now: () => NOW });
  return { storageScopeId: SCOPE, readiness: readinessPort, grants, authorizations,
    sessionState: createLiveSessionStatePort(invitations, flag, () => NOW),
    gate: createLiveReaderGate({ bindings, registry, codeRights, invitations, sessions, now: () => NOW, invitationsQualified: flag }),
    consent: async (principalId: string) => consent(principalId) };
}
const admit = (principalId: string, p = ports(), lifetimeSeconds = LIVE_HTTP_ASSERTION_SECONDS) =>
  admitLive(p, { host: HOST, artifactId: ARTIFACT, principalId, kid: KID, nowMs: NOW, lifetimeSeconds });
const service = () => createLiveInvitationService({ bindings, registry, codeRights, invitations, sessions, now: () => NOW,
  invitationsQualified: flag });
const owner = { actorId: "alice", storageScopeId: SCOPE, scopes: OWNER_SCOPES };
const invite = (inviteeId: string, ttlMs?: number) => service().create(owner, { artifactId: ARTIFACT, inviteeId,
  ...(ttlMs ? { ttlMs } : {}) });
const accept = (principalId: string, invitationId: string, p = ports()) =>
  acceptLiveInvitation(p, { artifactId: ARTIFACT, principalId, invitationId, nowMs: NOW });

beforeEach(async () => {
  bindings = createMemoryGitBindingStore();
  invitations = createMemoryLiveInvitationStore();
  authorizations = createMemoryLiveAuthorizationStore(() => NOW);
  await bindings.write({ binding, expectedVersion: null, actorId: "alice", idempotencyKey: "k", commandHash: "h", event: { action: "attach" } });
  readiness = { revision: "rev-7", ready: true, liveSessionId: SESSION };
  grantOver = {};
  invitationsOn = true;
  // Fake controller: grants what was asked at the current revision; an invitee carries the epoch of its request.
  fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { actor: { principalId: string; invitation?: { id: string; epoch: number;
      expiresAt: number } } };
    const invited = body.actor.invitation;
    const grant: LiveGrant = { storageScopeId: SCOPE, artifactId: ARTIFACT, sessionId: SESSION, generation: 1, routeEpoch: 2,
      podUid: "pod-uid-1", podName: livePodName(SCOPE, ARTIFACT), sourceRevision: "rev-7", principalId: body.actor.principalId,
      role: invited ? "invitee" : "binding_owner", invitationId: invited?.id ?? "", invitationEpoch: invited?.epoch ?? 0,
      invitationExp: invited ? Math.floor(invited.expiresAt / 1000) : 0, ...grantOver };
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

  it("refuses every invitee while invitations are not qualified (epoch kept, no active expiry)", async () => {
    const invitation = await invite("carol");
    await accept("carol", invitation.invitationId);
    invitationsOn = false;
    expect(await admit("carol")).toEqual({ kind: "none" });
    expect(await admit("alice")).toMatchObject({ kind: "live" });
    // Never lowered: the owner keeps sending the session epoch (1), with no active expiry.
    expect(bodies().at(-1)!.invitation).toEqual({ epoch: 1, expiresAt: null });
    await expect(invite("dave")).rejects.toMatchObject({ kind: "provider_unavailable" });
  });
});

describe("§8.2 gate: all four conditions", () => {
  it("(c)+(d) admits the binding owner and creates its live authorization record on the first admitted open", async () => {
    expect(await admit("alice")).toMatchObject({ kind: "live", claims: { role: "binding_owner", principalId: "alice" } });
    expect([...authorizations.rows.values()]).toMatchObject([{ role: "binding_owner", principalId: "alice", sessionId: SESSION,
      bindingGeneration: 1, invitationId: "", revokedAt: null }]);
    expect(await admit("alice")).toMatchObject({ kind: "live" });
    expect(authorizations.rows.size).toBe(1);
  });

  it("(d) refuses the owner when its record of this session is revoked", async () => {
    await admit("alice");
    await authorizations.revokeSession(SCOPE, ARTIFACT, SESSION, new Date(NOW).toISOString());
    expect(await admit("alice")).toEqual({ kind: "none" });
  });

  it("(d) refuses an invitee until explicit acceptance, then admits it", async () => {
    const invitation = await invite("carol");
    expect(await admit("carol")).toEqual({ kind: "none" });
    const record = await accept("carol", invitation.invitationId);
    expect(record).toMatchObject({ role: "invitee", invitationId: invitation.invitationId, sessionId: SESSION, bindingGeneration: 1,
      expiresAt: invitation.expiresAt });
    expect(await admit("carol")).toMatchObject({ kind: "live", claims: { role: "invitee", invitationId: invitation.invitationId,
      invitationEpoch: 1 } });
  });

  it("(c) refuses a revoked invitee and a stranger; (b) refuses without code rights; (a) refuses without consent", async () => {
    const invitation = await invite("carol");
    await accept("carol", invitation.invitationId);
    await service().revoke(owner, { artifactId: ARTIFACT, invitationId: invitation.invitationId });
    expect(await admit("carol")).toEqual({ kind: "none" });
    expect(await admit("dave")).toEqual({ kind: "none" });
    expect(await admit("mallory")).toEqual({ kind: "none" });
    expect(await admit("alice", ports(() => false))).toEqual({ kind: "none" });
    // Acceptance follows the same gate.
    await expect(accept("dave", invitation.invitationId)).rejects.toMatchObject({ kind: "access_denied" });
    await expect(accept("alice", invitation.invitationId)).rejects.toMatchObject({ kind: "access_denied" });
  });

  it("binds records to the grant session: a new session needs a new record; an invitee is never signed elsewhere", async () => {
    await admit("alice");
    await authorizations.revokeSession(SCOPE, ARTIFACT, SESSION, new Date(NOW).toISOString());
    expect(await admit("alice")).toEqual({ kind: "none" });
    // Stop then a new controller session: the revoked record of sess-1 does not cover sess-2; the owner gets a new one.
    readiness = { revision: "rev-7", ready: true, liveSessionId: "sess-2" };
    grantOver = { sessionId: "sess-2" };
    expect(await admit("alice")).toMatchObject({ kind: "live", claims: { sessionId: "sess-2" } });
    expect([...authorizations.rows.values()].map((row) => [row.sessionId, row.revokedAt === null])).toEqual([[SESSION, false],
      ["sess-2", true]]);
    // L1: the invitation is bound to sess-1; a grant for sess-2 is never signed for the invitee.
    const invitation = await invite("carol");
    await expect(accept("carol", invitation.invitationId)).rejects.toMatchObject({ kind: "git_live_conflict" });
    expect(await admit("carol")).toEqual({ kind: "release", reason: "grant_mismatch" });
  });
});

describe("several invitees share the session epoch", () => {
  it("revoking one bumps the epoch for all; the others keep working with it; the revoked one is refused", async () => {
    const carol = await invite("carol", 30 * 60_000);
    const dave = await invite("dave", 2 * 3600_000);
    expect([carol.epoch, dave.epoch]).toEqual([1, 1]);
    await accept("carol", carol.invitationId);
    await accept("dave", dave.invitationId);
    expect(await admit("dave")).toMatchObject({ kind: "live", claims: { invitationEpoch: 1 } });
    // expiresAt = the LATEST expiry among the active invitations.
    expect(bodies().at(-1)!.invitation).toEqual({ epoch: 1, expiresAt: Date.parse(dave.expiresAt) });
    const revoked = await service().revoke(owner, { artifactId: ARTIFACT, invitationId: dave.invitationId });
    expect(revoked.epoch).toBe(2);
    expect(await admit("dave")).toEqual({ kind: "none" });
    expect(await admit("carol")).toMatchObject({ kind: "live", claims: { invitationEpoch: 2, invitationId: carol.invitationId } });
    const carolBody = bodies().at(-1)!;
    expect(carolBody.actor.invitation).toMatchObject({ id: carol.invitationId, epoch: 2 });
    expect(carolBody.invitation).toEqual({ epoch: 2, expiresAt: Date.parse(carol.expiresAt) });
    // The owner sends the same session state, never 0 once an epoch exists.
    await admit("alice");
    expect(bodies().at(-1)!.invitation).toEqual({ epoch: 2, expiresAt: Date.parse(carol.expiresAt) });
    // Replace: a new invitation for the same invitee bumps again; the epoch is never decreased.
    const erin = await invite("erin");
    expect(erin.epoch).toBe(2);
    const carol2 = await invite("carol");
    expect(carol2.epoch).toBe(3);
    const epochs = (await invitations.list(SCOPE, ARTIFACT)).map((row) => row.epoch);
    expect(new Set(epochs)).toEqual(new Set([3]));
    await admit("alice");
    expect(bodies().map((body) => body.invitation.epoch)).toEqual([...bodies().map((body) => body.invitation.epoch)].sort());
    expect(bodies().at(-1)!.invitation.epoch).toBe(3);
  });

  it("refuses an expired invitation individually", async () => {
    const carol = await invite("carol", 60_000);
    const dave = await invite("dave", 3600_000);
    await accept("carol", carol.invitationId);
    await accept("dave", dave.invitationId);
    const later = { ...ports(), sessionState: createLiveSessionStatePort(invitations, flag, () => NOW + 120_000),
      gate: createLiveReaderGate({ bindings, registry, codeRights, invitations, sessions, now: () => NOW + 120_000,
        invitationsQualified: flag }) };
    const at = (principalId: string) => admitLive(later, { host: HOST, artifactId: ARTIFACT, principalId, kid: KID,
      nowMs: NOW + 120_000, lifetimeSeconds: 60 });
    expect(await at("carol")).toEqual({ kind: "none" });
    expect(await at("dave")).toMatchObject({ kind: "live" });
    expect(bodies().at(-1)!.invitation).toEqual({ epoch: 1, expiresAt: Date.parse(dave.expiresAt) });
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

  it("serves the release when the grant names another revision, scope, generation or session", async () => {
    for (const over of [{ sourceRevision: "rev-6" }, { storageScopeId: "other-scope", podName: livePodName("other-scope", ARTIFACT) },
      { generation: 2 }, { sessionId: "sess-9" }] as Partial<LiveGrant>[]) {
      grantOver = over;
      const p = ports();
      expect(await admit("alice", p)).toEqual({ kind: "release", reason: "grant_mismatch" });
      expect(p.grants.size()).toBe(0);
    }
    expect(authorizations.rows.size).toBe(0);
  });

  it("serves the release on a refused or unavailable grant", async () => {
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: "invalid_phase" }), { status: 409 }));
    expect(await admit("alice")).toEqual({ kind: "release", reason: "grant_invalid_phase" });
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: "stale_invitation" }), { status: 409 }));
    expect(await admit("alice")).toEqual({ kind: "release", reason: "grant_stale_invitation" });
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

  it("caps an invitee websocket assertion at the invitation expiry (invitation fields from the grant)", async () => {
    const invitation = await invite("carol");
    await accept("carol", invitation.invitationId);
    const admission = await admit("carol", ports(), LIVE_WS_ASSERTION_SECONDS);
    if (admission.kind !== "live") throw new Error("expected live");
    const claims = verify(signLiveAssertion(admission.claims, KEY))!;
    expect(claims.exp).toBe(Math.min(Math.floor(NOW / 1000) + 3600, claims.invitationExp));
    expect(claims.exp).toBeLessThanOrEqual(claims.invitationExp);
    expect({ id: claims.invitationId, epoch: claims.invitationEpoch, exp: claims.invitationExp }).toEqual({ id: admission.grant.invitationId,
      epoch: admission.grant.invitationEpoch, exp: admission.grant.invitationExp });
    const ownerAdmission = await admit("alice", ports(), LIVE_WS_ASSERTION_SECONDS);
    if (ownerAdmission.kind !== "live") throw new Error("expected live");
    expect(ownerAdmission.claims.exp - ownerAdmission.claims.iat).toBe(3600);
    expect(ownerAdmission.claims.invitationEpoch).toBe(0);
  });

  it("drops extra grant fields and refuses an expired invitation", () => {
    const base: LiveGrant = { storageScopeId: SCOPE, artifactId: ARTIFACT, sessionId: SESSION, generation: 1, routeEpoch: 2,
      podUid: "pod-uid-1", podName: livePodName(SCOPE, ARTIFACT), sourceRevision: "rev-7", principalId: "carol", role: "invitee",
      invitationId: "inv-1", invitationEpoch: 1, invitationExp: Math.floor(NOW / 1000) };
    expect(liveAssertionFromGrant({ grant: base, kid: KID, host: HOST, nowMs: NOW, lifetimeSeconds: 60 })).toBeUndefined();
    const extra = { ...base, role: "binding_owner", principalId: "alice", invitationId: "", invitationEpoch: 0, invitationExp: 0,
      extra: "x" } as LiveGrant;
    const claims = liveAssertionFromGrant({ grant: extra, kid: KID, host: HOST.toUpperCase(), nowMs: NOW, lifetimeSeconds: 60 })!;
    expect(Object.keys(claims)).not.toContain("extra");
    expect(claims.host).toBe(HOST);
  });

  it("builds the grant request from the gate role and the session state", () => {
    const session = { epoch: 3, expiresAt: NOW };
    expect(grantRequestFor(ARTIFACT, { role: "binding_owner", principalId: "alice", bindingGeneration: 1 }, session))
      .toEqual({ artifactId: ARTIFACT, bindingGeneration: 1, principalId: "alice", session });
    expect(grantRequestFor(ARTIFACT, { role: "invitee", principalId: "carol", bindingGeneration: 1, invitationId: "inv-1", epoch: 3,
      expiresAt: new Date(NOW).toISOString(), liveSessionId: SESSION }, session))
      .toEqual({ artifactId: ARTIFACT, bindingGeneration: 1, principalId: "carol", session, invitation: { id: "inv-1", expiresAt: NOW } });
  });
});
