import { createMemoryGitBindingStore, type GitBinding } from "@sentropic/artifacts";
import { verifyLiveControl } from "@sentropic/artifacts/live-host";
import { describe, expect, it, vi } from "vitest";
import { createLiveInvitationService, createMemoryLiveInvitationStore } from "./live-authority.js";
import {
  composeLiveEdgeRevocation, createLiveFencePusher, createLiveRevocation, createLiveSocketRegistry, FAIL_CLOSED_LIVE_SIGNER,
  liveSignerFrom, loadLiveSigner, parseLiveHostKeyring, readLiveEdgeConfig,
  LIVE_CONTROL_HEADER, type LiveAssertionSigner,
} from "./live-edge.js";
import { createImmoGitRegistry, IMMO_GIT_REPO_ID } from "./registry.js";

const SCOPE = "s";
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
const signer: LiveAssertionSigner = { signAssertion: () => "v1.a.b", signControl: (claims) => `c1.${claims.op}.${claims.invitationId || claims.sessionId}` };
const socket = () => ({ close: vi.fn() });
const noSleep = async () => {};

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
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const push = createLiveFencePusher({ signer, kid: "k1", host: "pages.preprod.immo.sent-tech.ca", fetch: fetcher as never,
      controlUrl: (artifactId) => new URL(`https://edge.internal/${artifactId}/_live-control/v1`), sleep: noSleep });
    const result = await createLiveRevocation({ sockets, push }).invitation({ invitationId: "inv-1", storageScopeId: SCOPE,
      artifactId: ARTIFACT, bindingGeneration: 1, liveSessionId: "sess", inviteeId: "carol", grantorId: "alice",
      createdAt: "", expiresAt: "", revokedAt: "x", epoch: 2 });
    expect(result.closed).toBe(1);
    expect(invitee.close).toHaveBeenCalledWith(4403, "invitation_revoked");
    expect(other.close).not.toHaveBeenCalled();
    expect(owner.close).not.toHaveBeenCalled();
    const [url, init] = fetcher.mock.calls[0]! as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`https://edge.internal/${ARTIFACT}/_live-control/v1`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)[LIVE_CONTROL_HEADER]).toBe("c1.revoke_invitation.inv-1");
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
    const refused = new Response("refused", { status: 404 });
    const unavailable = new Response("busy", { status: 503 });
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("reset"))
      .mockResolvedValueOnce(refused)
      .mockResolvedValueOnce(unavailable);
    const push = createLiveFencePusher({ signer, kid: "k1", host: "pages.test", fetch: fetcher as never,
      controlUrl: () => new URL("https://edge.internal/_live-control/v1"), sleep: noSleep });
    await expect(createLiveRevocation({ sockets, push }).invitation({ invitationId: "inv-1", storageScopeId: SCOPE,
      artifactId: ARTIFACT, bindingGeneration: 1, liveSessionId: "sess", inviteeId: "carol", grantorId: "alice",
      createdAt: "", expiresAt: "", revokedAt: "x", epoch: 2 })).rejects.toMatchObject({ kind: "provider_unavailable",
      details: { publicDetails: { fence: "push_failed", status: 503 } } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(refused.bodyUsed).toBe(true);
    expect(unavailable.bodyUsed).toBe(true);
    expect(invitee.close).toHaveBeenCalled();
    expect(sockets.size()).toBe(0);
  });

  it("treats any 2xx as pushed and drains its body", async () => {
    const accepted = new Response("ok", { status: 200 });
    const push = createLiveFencePusher({ signer, kid: "k1", host: "pages.test", fetch: (async () => accepted) as never,
      controlUrl: () => new URL("https://edge.internal/_live-control/v1"), sleep: noSleep });
    await expect(push({ artifactId: ARTIFACT, op: "revoke_session", sessionId: "sess", invitationId: "", epoch: 0 }))
      .resolves.toBeUndefined();
    expect(accepted.bodyUsed).toBe(true);
  });

  it("succeeds on a retry after a transient failure", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const push = createLiveFencePusher({ signer, kid: "k1", host: "pages.test", fetch: fetcher as never,
      controlUrl: () => new URL("https://edge.internal/_live-control/v1"), sleep: noSleep });
    await expect(push({ artifactId: ARTIFACT, op: "revoke_session", sessionId: "sess", invitationId: "", epoch: 0 }))
      .resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refuses to push while the edge or the signer is not configured", async () => {
    const claims = { artifactId: ARTIFACT, op: "revoke_session" as const, sessionId: "s", invitationId: "", epoch: 0 };
    await expect(createLiveFencePusher({ signer, kid: "k", host: "h" })(claims)).rejects.toMatchObject({ kind: "provider_unavailable" });
    await expect(createLiveFencePusher({ signer: FAIL_CLOSED_LIVE_SIGNER, kid: "k", host: "h",
      controlUrl: () => new URL("https://edge.internal/x") })(claims)).rejects.toMatchObject({ kind: "provider_unavailable" });
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
  it("reads the HMAC keyring, the signing kid, the pages host and the control URL", () => {
    const config = readLiveEdgeConfig({ IMMO_ARTIFACTS_LIVE_HOST_KEYS: `immo-preprod-live-1=${key},immo-preprod-live-0=${key}`,
      IMMO_ARTIFACTS_LIVE_HOST_KID: "immo-preprod-live-1", IMMO_ARTIFACTS_LIVE_HOST: "pages.preprod.immo.sent-tech.ca",
      IMMO_ARTIFACTS_LIVE_CONTROL_URL: "https://pages.preprod.immo.sent-tech.ca/_live-control/v1" });
    expect(config.kid).toBe("immo-preprod-live-1");
    expect(config.key?.byteLength).toBe(32);
    expect(String(config.controlUrl)).toBe("https://pages.preprod.immo.sent-tech.ca/_live-control/v1");
    expect(parseLiveHostKeyring(undefined).size).toBe(0);
  });

  it("refuses short keys, an unknown kid and a foreign control path", () => {
    expect(() => parseLiveHostKeyring(`k=${Buffer.alloc(16).toString("base64url")}`)).toThrow("artifact_live_host_keys_invalid");
    expect(() => readLiveEdgeConfig({ IMMO_ARTIFACTS_LIVE_HOST_KEYS: `a=${key}`, IMMO_ARTIFACTS_LIVE_HOST_KID: "b" }))
      .toThrow("artifact_live_host_kid_invalid");
    expect(() => readLiveEdgeConfig({ IMMO_ARTIFACTS_LIVE_CONTROL_URL: "https://pages.example/other" }))
      .toThrow("artifact_live_control_url_invalid");
  });

  it("pushes revocations the edge verifies with the provider live format (exact claim set, 0.2.20)", async () => {
    const sockets = createLiveSocketRegistry();
    const open = socket();
    sockets.register({ artifactId: ARTIFACT, sessionId: "sess", principalId: "alice" }, open);
    const tokens: string[] = [];
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      tokens.push((init.headers as Record<string, string>)[LIVE_CONTROL_HEADER]!);
      return new Response(null, { status: 204 });
    });
    const config = readLiveEdgeConfig({ IMMO_ARTIFACTS_LIVE_HOST_KEYS: `immo-preprod-live-1=${key}`,
      IMMO_ARTIFACTS_LIVE_HOST_KID: "immo-preprod-live-1", IMMO_ARTIFACTS_LIVE_HOST: "pages.test",
      IMMO_ARTIFACTS_LIVE_CONTROL_URL: "https://pages.test/_live-control/v1" });
    const revocation = await composeLiveEdgeRevocation(config, sockets, fetcher as never);
    await expect(revocation.session(ARTIFACT, "sess")).resolves.toEqual({ closed: 1 });
    await revocation.invitation({ invitationId: "inv-1", storageScopeId: SCOPE, artifactId: ARTIFACT, bindingGeneration: 1,
      liveSessionId: "sess", inviteeId: "carol", grantorId: "alice", createdAt: "", expiresAt: "", revokedAt: "x", epoch: 2 });
    expect(open.close).toHaveBeenCalled();
    const verify = (token: string) => verifyLiveControl(token, { key: (kid) => kid === "immo-preprod-live-1" ? config.key : undefined,
      now: () => Date.now() });
    expect(verify(tokens[0]!)).toMatchObject({ op: "revoke_session", sessionId: "sess", invitationId: "", epoch: 0, host: "pages.test" });
    expect(verify(tokens[1]!)).toMatchObject({ op: "revoke_invitation", sessionId: "", invitationId: "inv-1", epoch: 2 });
  });
});
