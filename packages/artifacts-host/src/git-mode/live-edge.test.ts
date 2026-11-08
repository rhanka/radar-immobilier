import { createMemoryGitBindingStore, type GitBinding } from "@sentropic/artifacts";
import { verifyLiveControl } from "@sentropic/artifacts/live-host";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { createLiveInvitationService, createMemoryLiveInvitationStore } from "./live-authority.js";
import {
  composeLiveEdgeRevocation, createLiveFencePusher, createLiveRevocation, createLiveSocketRegistry, FAIL_CLOSED_LIVE_SIGNER,
  liveSignerFrom, loadLiveSigner, nodeHttpControlTransport, parseLiveHostKeyring, readLiveEdgeConfig,
  LIVE_CONTROL_HEADER, type LiveAssertionSigner, type LiveControlTransport,
} from "./live-edge.js";
import { createImmoGitRegistry, IMMO_GIT_REPO_ID } from "./registry.js";

const SCOPE = "s";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const signer: LiveAssertionSigner = { signAssertion: () => "v1.a.b", signControl: (claims) => `c1.${claims.op}.${claims.invitationId || claims.sessionId}` };
const socket = () => ({ close: vi.fn() });
const noSleep = async () => {};
const EDGE = new URL("http://artifact-content.sentropic-preprod.svc.cluster.local:8791");
const DOMAIN = "pages.preprod.immo.sent-tech.ca";
type Sent = Parameters<LiveControlTransport>[0];
const transport = (...statuses: Array<number | Error>) => {
  const sent: Sent[] = [];
  const send = vi.fn(async (input: Sent) => {
    sent.push(input);
    const next = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
    if (next instanceof Error) throw next;
    return next;
  });
  return { send, sent };
};

describe("live signer adapter (provider export only)", () => {
  it("binds the provider live-host signer (0.2.20) and fails closed without the export or with a short key", async () => {
    expect(await loadLiveSigner(new Uint8Array(32))).not.toBe(FAIL_CLOSED_LIVE_SIGNER);
    expect(await loadLiveSigner(undefined)).toBe(FAIL_CLOSED_LIVE_SIGNER);
    expect(liveSignerFrom(undefined, new Uint8Array(32))).toBe(FAIL_CLOSED_LIVE_SIGNER);
    expect(() => FAIL_CLOSED_LIVE_SIGNER.signControl({} as never)).toThrow();
    expect(liveSignerFrom({ signLiveAssertion: () => "x", signLiveControl: () => "y" }, new Uint8Array(16))).toBe(FAIL_CLOSED_LIVE_SIGNER);
  });

  it("binds the provider signer to the host key", () => {
    const signLiveControl = vi.fn(() => "c1.token");
    const bound = liveSignerFrom({ signLiveAssertion: () => "v1.token", signLiveControl }, new Uint8Array(32));
    expect(bound.signControl({ op: "revoke_session" } as never)).toBe("c1.token");
    expect(signLiveControl).toHaveBeenCalledWith({ op: "revoke_session" }, new Uint8Array(32));
  });
});

describe("live revocation: sockets closed, fence pushed", () => {
  it("closes the invitee's open sockets and pushes revoke_invitation to the control port", async () => {
    const sockets = createLiveSocketRegistry();
    const invitee = socket(); const other = socket(); const owner = socket();
    sockets.register({ artifactId: ARTIFACT, sessionId: "sess", principalId: "carol", invitationId: "inv-1" }, invitee);
    sockets.register({ artifactId: ARTIFACT, sessionId: "sess", principalId: "dave", invitationId: "inv-2" }, other);
    sockets.register({ artifactId: ARTIFACT, sessionId: "sess", principalId: "alice" }, owner);
    const { send, sent } = transport(204);
    const push = createLiveFencePusher({ signer, kid: "k1", pagesDomain: DOMAIN, target: EDGE, send, sleep: noSleep });
    const result = await createLiveRevocation({ sockets, push }).invitation({ invitationId: "inv-1", storageScopeId: SCOPE,
      artifactId: ARTIFACT, bindingGeneration: 1, liveSessionId: "sess", inviteeId: "carol", grantorId: "alice",
      createdAt: "", expiresAt: "", revokedAt: "x", epoch: 2 });
    expect(result.closed).toBe(1);
    expect(invitee.close).toHaveBeenCalledWith(4403, "invitation_revoked");
    expect(other.close).not.toHaveBeenCalled();
    expect(owner.close).not.toHaveBeenCalled();
    // Internal Service, per-artifact pages Host, signed control header.
    expect(sent[0]).toMatchObject({ target: EDGE, host: `${ARTIFACT}.${DOMAIN}`, path: "/_live-control/v1",
      headers: { [LIVE_CONTROL_HEADER]: "c1.revoke_invitation.inv-1" } });
  });

  it("closes every socket of a revoked session", async () => {
    const sockets = createLiveSocketRegistry();
    const a = socket(); const b = socket();
    sockets.register({ artifactId: ARTIFACT, sessionId: "sess", principalId: "alice" }, a);
    sockets.register({ artifactId: ARTIFACT, sessionId: "sess", principalId: "carol", invitationId: "inv-1" }, b);
    const push = vi.fn(async () => {});
    expect((await createLiveRevocation({ sockets, push }).session(ARTIFACT, "sess")).closed).toBe(2);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ op: "revoke_session", sessionId: "sess" }));
    expect(sockets.size()).toBe(0);
  });

  it("retries a failed push, then surfaces the failure with the socket already closed", async () => {
    const sockets = createLiveSocketRegistry();
    const invitee = socket();
    sockets.register({ artifactId: ARTIFACT, sessionId: "sess", principalId: "carol", invitationId: "inv-1" }, invitee);
    const { send } = transport(new Error("reset"), 404, 503);
    const push = createLiveFencePusher({ signer, kid: "k1", pagesDomain: "pages.test", target: EDGE, send, sleep: noSleep });
    await expect(createLiveRevocation({ sockets, push }).invitation({ invitationId: "inv-1", storageScopeId: SCOPE,
      artifactId: ARTIFACT, bindingGeneration: 1, liveSessionId: "sess", inviteeId: "carol", grantorId: "alice",
      createdAt: "", expiresAt: "", revokedAt: "x", epoch: 2 })).rejects.toMatchObject({ kind: "provider_unavailable",
      details: { publicDetails: { fence: "push_failed", status: 503 } } });
    expect(send).toHaveBeenCalledTimes(3);
    expect(invitee.close).toHaveBeenCalled();
    expect(sockets.size()).toBe(0);
  });

  it("treats any 2xx as pushed", async () => {
    const push = createLiveFencePusher({ signer, kid: "k1", pagesDomain: "pages.test", target: EDGE, send: transport(200).send,
      sleep: noSleep });
    await expect(push({ artifactId: ARTIFACT, op: "revoke_session", sessionId: "sess", invitationId: "", epoch: 0 }))
      .resolves.toBeUndefined();
  });

  it("posts with node:http to the internal Service with the exact Host, and drains the body", async () => {
    const seen: Array<{ method: string | undefined; url: string | undefined; host: string | undefined; control: string; cookie: string | undefined }> = [];
    const server = createServer((req: IncomingMessage, res) => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, control: req.headers[LIVE_CONTROL_HEADER] as string,
        cookie: req.headers.cookie });
      res.writeHead(204).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const target = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      const push = createLiveFencePusher({ signer, kid: "k1", pagesDomain: DOMAIN, target, sleep: noSleep });
      await push({ artifactId: ARTIFACT, op: "revoke_session", sessionId: "sess", invitationId: "", epoch: 0 });
      expect(seen).toEqual([{ method: "POST", url: "/_live-control/v1", host: `${ARTIFACT}.${DOMAIN}`,
        control: "c1.revoke_session.sess", cookie: undefined }]);
      await expect(nodeHttpControlTransport({ target, host: "h", path: "/x", headers: {}, timeoutMs: 1000 })).resolves.toBe(204);
    } finally { server.close(); }
  });

  it("succeeds on a retry after a transient failure", async () => {
    const { send } = transport(new Error("reset"), 204);
    const push = createLiveFencePusher({ signer, kid: "k1", pagesDomain: "pages.test", target: EDGE, send, sleep: noSleep });
    await expect(push({ artifactId: ARTIFACT, op: "revoke_session", sessionId: "sess", invitationId: "", epoch: 0 }))
      .resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("refuses to push while the edge or the signer is not configured", async () => {
    const claims = { artifactId: ARTIFACT, op: "revoke_session" as const, sessionId: "s", invitationId: "", epoch: 0 };
    await expect(createLiveFencePusher({ signer, kid: "k", pagesDomain: "h" })(claims)).rejects.toMatchObject({ kind: "provider_unavailable" });
    await expect(createLiveFencePusher({ signer, kid: "k", pagesDomain: "", target: EDGE })(claims))
      .rejects.toMatchObject({ kind: "provider_unavailable" });
    await expect(createLiveFencePusher({ signer: FAIL_CLOSED_LIVE_SIGNER, kid: "k", pagesDomain: "h", target: EDGE,
      send: transport(204).send })(claims)).rejects.toMatchObject({ kind: "provider_unavailable" });
  });

  it("runs the edge revocation from the invitation service revoke", async () => {
    const bindings = createMemoryGitBindingStore();
    const binding: GitBinding = { artifactId: ARTIFACT, storageScopeId: SCOPE, repoId: IMMO_GIT_REPO_ID,
      branch: "artifact/p/alice000/triage-11111111", channel: "personal", personalPrincipalId: "alice", subPath: "",
      baseCommitSha: "a".repeat(40), headCommitSha: "a".repeat(40), releaseCommitSha: null, autoPublish: true, executor: "sandbox",
      pendingJobId: null, pendingCommitSha: null, state: "attached", generation: 1, version: 1, attachedBy: "alice",
      attachedAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z" };
    await bindings.write({ binding, expectedVersion: null, actorId: "alice", idempotencyKey: "k", commandHash: "h", event: { action: "attach" } });
    const sockets = createLiveSocketRegistry();
    const push = vi.fn(async () => {});
    const revocation = createLiveRevocation({ sockets, push });
    const service = createLiveInvitationService({ bindings, invitations: createMemoryLiveInvitationStore(),
      registry: createImmoGitRegistry({ storageScopeId: SCOPE, installationRef: "inst" }),
      codeRights: { canReadCode: async () => true }, sessions: { current: async () => ({ liveSessionId: "sess" }) },
      onRevoked: (invitation) => revocation.invitation(invitation) });
    const caller = { actorId: "alice", storageScopeId: SCOPE, scopes: ["immo:artifacts:read", "immo:artifacts:write"] };
    const created = await service.create(caller, { artifactId: ARTIFACT, inviteeId: "carol" });
    const open = socket();
    sockets.register({ artifactId: ARTIFACT, sessionId: "sess", principalId: "carol", invitationId: created.invitationId }, open);
    await service.revoke(caller, { artifactId: ARTIFACT, invitationId: created.invitationId });
    expect(open.close).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ op: "revoke_invitation", invitationId: created.invitationId, epoch: 2 }));
  });
});

describe("live edge configuration", () => {
  const key = Buffer.alloc(32, 9).toString("base64url");
  it("reads the HMAC keyring, the signing kid, the pages host and the internal edge URL", () => {
    const config = readLiveEdgeConfig({ IMMO_ARTIFACTS_LIVE_HOST_KEYS: `immo-preprod-live-1=${key},immo-preprod-live-0=${key}`,
      IMMO_ARTIFACTS_LIVE_HOST_KID: "immo-preprod-live-1", IMMO_ARTIFACTS_LIVE_HOST: "pages.preprod.immo.sent-tech.ca",
      IMMO_ARTIFACTS_LIVE_CONTROL_URL: "https://pages.preprod.immo.sent-tech.ca/_live-control/v1",
      IMMO_ARTIFACTS_LIVE_EDGE_URL: "http://artifact-content.sentropic-preprod.svc.cluster.local:8791" });
    expect(config.kid).toBe("immo-preprod-live-1");
    expect(config.key?.byteLength).toBe(32);
    // Superseded public control URL: still validated, never used for transport.
    expect(String(config.controlUrl)).toBe("https://pages.preprod.immo.sent-tech.ca/_live-control/v1");
    expect(String(config.edgeUrl)).toBe("http://artifact-content.sentropic-preprod.svc.cluster.local:8791/");
    expect(parseLiveHostKeyring(undefined).size).toBe(0);
  });

  it("refuses short keys, an unknown kid and a foreign control path", () => {
    expect(() => parseLiveHostKeyring(`k=${Buffer.alloc(16).toString("base64url")}`)).toThrow("artifact_live_host_keys_invalid");
    expect(() => readLiveEdgeConfig({ IMMO_ARTIFACTS_LIVE_HOST_KEYS: `a=${key}`, IMMO_ARTIFACTS_LIVE_HOST_KID: "b" }))
      .toThrow("artifact_live_host_kid_invalid");
    expect(() => readLiveEdgeConfig({ IMMO_ARTIFACTS_LIVE_CONTROL_URL: "https://pages.example/other" }))
      .toThrow("artifact_live_control_url_invalid");
    for (const bad of ["ftp://edge:1", "http://u:p@edge:1", "http://edge:1/path", "http://edge:1/?q=1", "not a url"]) {
      expect(() => readLiveEdgeConfig({ IMMO_ARTIFACTS_LIVE_EDGE_URL: bad })).toThrow("artifact_live_edge_url_invalid");
    }
  });

  it("pushes revocations the edge verifies with the provider live format (exact claim set, 0.2.20)", async () => {
    const sockets = createLiveSocketRegistry();
    const open = socket();
    sockets.register({ artifactId: ARTIFACT, sessionId: "sess", principalId: "alice" }, open);
    const { send, sent } = transport(204);
    const config = readLiveEdgeConfig({ IMMO_ARTIFACTS_LIVE_HOST_KEYS: `immo-preprod-live-1=${key}`,
      IMMO_ARTIFACTS_LIVE_HOST_KID: "immo-preprod-live-1", IMMO_ARTIFACTS_LIVE_HOST: "pages.test",
      IMMO_ARTIFACTS_LIVE_EDGE_URL: "http://artifact-content.test:8791" });
    const revocation = await composeLiveEdgeRevocation(config, sockets, send);
    const tokens = () => sent.map((input) => input.headers[LIVE_CONTROL_HEADER]!);
    await expect(revocation.session(ARTIFACT, "sess")).resolves.toEqual({ closed: 1 });
    await revocation.invitation({ invitationId: "inv-1", storageScopeId: SCOPE, artifactId: ARTIFACT, bindingGeneration: 1,
      liveSessionId: "sess", inviteeId: "carol", grantorId: "alice", createdAt: "", expiresAt: "", revokedAt: "x", epoch: 2 });
    expect(open.close).toHaveBeenCalled();
    const verify = (token: string) => verifyLiveControl(token, { key: (kid) => kid === "immo-preprod-live-1" ? config.key : undefined,
      now: () => Date.now() });
    const [session, invitation] = tokens().map(verify);
    expect(session).toMatchObject({ op: "revoke_session", sessionId: "sess", invitationId: "", epoch: 0, host: `${ARTIFACT}.pages.test` });
    expect(invitation).toMatchObject({ op: "revoke_invitation", sessionId: "", invitationId: "inv-1", epoch: 2,
      host: `${ARTIFACT}.pages.test` });
    // Exactly the 10 CONTROL_FIELDS.
    expect(Object.keys(invitation!).sort()).toEqual(["artifactId", "epoch", "exp", "host", "iat", "invitationId", "kid", "op",
      "sessionId", "v"]);
    expect(sent.every((input) => input.host === `${ARTIFACT}.pages.test` && String(input.target) === "http://artifact-content.test:8791/"))
      .toBe(true);
  });

  it("keeps the push closed without the internal edge URL and drops cached grants on revocation", async () => {
    const config = readLiveEdgeConfig({ IMMO_ARTIFACTS_LIVE_HOST_KEYS: `immo-preprod-live-1=${key}`,
      IMMO_ARTIFACTS_LIVE_HOST_KID: "immo-preprod-live-1", IMMO_ARTIFACTS_LIVE_HOST: "pages.test" });
    const revocation = await composeLiveEdgeRevocation(config, createLiveSocketRegistry(), transport(204).send);
    await expect(revocation.session(ARTIFACT, "sess")).rejects.toMatchObject({ kind: "provider_unavailable" });
    const grants = { invalidate: vi.fn(), invalidateInvitation: vi.fn() };
    const withGrants = createLiveRevocation({ sockets: createLiveSocketRegistry(), push: vi.fn(async () => {}), grants });
    await withGrants.session(ARTIFACT, "sess");
    await withGrants.invitation({ invitationId: "inv-1", storageScopeId: SCOPE, artifactId: ARTIFACT, bindingGeneration: 1,
      liveSessionId: "sess", inviteeId: "carol", grantorId: "alice", createdAt: "", expiresAt: "", revokedAt: "x", epoch: 2 });
    expect(grants.invalidate).toHaveBeenCalledWith(ARTIFACT);
    expect(grants.invalidateInvitation).toHaveBeenCalledWith(ARTIFACT, "inv-1");
  });
});
