import {
  ASSERTION_HEADER, CONTROL_HEADER, LIVE_KEY_ID, type LiveAssertionClaims, type LiveControlClaims,
} from "@sentropic/artifacts/live-host";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { loadLiveHost, type LiveHostModule } from "./live-host-adapter.js";

/**
 * Host side of the live edge (M4-I, W9 contract).
 *
 * - Assertions and control messages are signed ONLY by the provider
 *   subpath `@sentropic/artifacts/live-host` (0.2.20, live-host-adapter.ts).
 *   immo carries no crypto of its own for them; the claim shapes are the
 *   package's (a control claim carries no generation or route epoch: the
 *   fence format is reserved to the Sentropic controller).
 * - Revocation (invitation or session): the host first closes every proxied
 *   browser socket it holds for that invitee or session (the host owns the
 *   browser socket), then pushes the revocation to artifact-content's control
 *   channel: `POST /_live-control/v1` on the INTERNAL artifact-content Service
 *   (IMMO_ARTIFACTS_LIVE_EDGE_URL) with Host = `<artifactId>.<pages domain>`
 *   and the same per-artifact host in the signed `x-live-host-control` claim
 *   (the edge scopes control to the artifact's own pages Host), via node:http;
 *   answered 204 (any refusal is a bare 404). Every response body is
 *   read to completion (no connection held between attempts); a non-2xx
 *   answer or a transport error is retried, and the final failure is
 *   surfaced with the last status, the sockets being already closed.
 */
export const LIVE_CONTROL_PATH = "/_live-control/v1" as const;
export const LIVE_CONTROL_HEADER = CONTROL_HEADER;
export const LIVE_ASSERTION_HEADER = ASSERTION_HEADER;
/** Claim shapes of the provider live format (`@sentropic/artifacts/live-host`), no local copy. */
export type { LiveAssertionClaims, LiveControlClaims } from "@sentropic/artifacts/live-host";

export interface LiveAssertionSigner {
  signAssertion(claims: LiveAssertionClaims): string;
  signControl(claims: LiveControlClaims): string;
}

export const FAIL_CLOSED_LIVE_SIGNER: LiveAssertionSigner = Object.freeze({
  signAssertion(): never { throw new ArtifactOperationError("provider_unavailable"); },
  signControl(): never { throw new ArtifactOperationError("provider_unavailable"); },
});

/** Provider signer bound to the host key; fail-closed when the export is absent or the key is short. */
export function liveSignerFrom(module: LiveHostModule | undefined, key: Uint8Array | undefined): LiveAssertionSigner {
  if (!module || typeof module.signLiveAssertion !== "function" || typeof module.signLiveControl !== "function" ||
    !key || key.byteLength < 32) return FAIL_CLOSED_LIVE_SIGNER;
  const assertion = module.signLiveAssertion as (claims: LiveAssertionClaims, key: Uint8Array) => string;
  const control = module.signLiveControl as (claims: LiveControlClaims, key: Uint8Array) => string;
  return { signAssertion: (claims) => assertion(claims, key), signControl: (claims) => control(claims, key) };
}

export async function loadLiveSigner(key: Uint8Array | undefined): Promise<LiveAssertionSigner> {
  return liveSignerFrom(await loadLiveHost(), key);
}

/** A proxied browser socket held by the immo content host. */
export interface LiveSocket { close(code: number, reason: string): void }
/** sessionId: controller grant session (HMR path); liveSessionId: package live session (records, invitations). */
export interface LiveSocketKey { readonly artifactId: string; readonly sessionId: string; readonly principalId: string;
  readonly invitationId?: string; readonly liveSessionId?: string }

export function createLiveSocketRegistry() {
  const sockets = new Map<LiveSocket, LiveSocketKey>();
  const close = (match: (key: LiveSocketKey) => boolean, reason: string) => {
    let closed = 0;
    for (const [socket, key] of [...sockets]) {
      if (!match(key)) continue;
      sockets.delete(socket);
      try { socket.close(4403, reason); } catch { /* already closed */ }
      closed += 1;
    }
    return closed;
  };
  const count = (match: (key: LiveSocketKey) => boolean) => [...sockets.values()].filter(match).length;
  return {
    register(key: LiveSocketKey, socket: LiveSocket) { sockets.set(socket, key); return () => { sockets.delete(socket); }; },
    size: () => sockets.size,
    /** Open sockets of one principal on one artifact, and of one session. */
    countPrincipal: (artifactId: string, principalId: string) =>
      count((key) => key.artifactId === artifactId && key.principalId === principalId),
    countSession: (artifactId: string, sessionId: string) =>
      count((key) => key.artifactId === artifactId && key.sessionId === sessionId),
    entries: () => [...sockets.entries()],
    closeInvitation: (artifactId: string, invitationId: string) =>
      close((key) => key.artifactId === artifactId && key.invitationId === invitationId, "invitation_revoked"),
    closeSession: (artifactId: string, sessionId: string) =>
      close((key) => key.artifactId === artifactId && key.sessionId === sessionId, "session_revoked"),
    /** Closes every socket of a package live session; returns the controller session ids they carried. */
    closeLiveSession(artifactId: string, liveSessionId: string) {
      const edge = new Set<string>();
      for (const [, key] of sockets) if (key.artifactId === artifactId && key.liveSessionId === liveSessionId) edge.add(key.sessionId);
      const closed = close((key) => key.artifactId === artifactId && key.liveSessionId === liveSessionId, "session_revoked");
      return { closed, edgeSessionIds: [...edge] };
    },
  };
}
export type LiveSocketRegistry = ReturnType<typeof createLiveSocketRegistry>;

/**
 * Control transport: one POST to the INTERNAL artifact-content Service with
 * an explicit Host header (node:http keeps it verbatim; fetch/undici would
 * not let the host choose it). Resolves the status once the body is drained.
 */
export type LiveControlTransport = (input: { readonly target: URL; readonly host: string; readonly path: string;
  readonly headers: Readonly<Record<string, string>>; readonly timeoutMs: number }) => Promise<number>;

export const nodeHttpControlTransport: LiveControlTransport = ({ target, host, path, headers, timeoutMs }) =>
  new Promise<number>((resolve, reject) => {
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = send({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: "POST",
      path, setHost: false, timeout: timeoutMs, headers: { ...headers, host, "content-length": "0" } });
    outgoing.once("timeout", () => outgoing.destroy(new Error("timeout")));
    outgoing.once("error", reject);
    outgoing.once("response", (response) => {
      response.once("error", reject);
      response.once("end", () => resolve(response.statusCode ?? 0));
      response.resume();
    });
    outgoing.end();
  });

/** The per-artifact pages Host the edge scopes a control message to (`<artifactId>.<pages domain>`). */
export const liveArtifactHost = (artifactId: string, pagesDomain: string) => `${artifactId}.${pagesDomain}`.toLowerCase();

export interface LiveFencePushOptions {
  readonly signer: LiveAssertionSigner;
  readonly kid: string;
  /** Host-owned pages domain (preprod `pages.preprod.immo.sent-tech.ca`); the claim host is `<artifactId>.<domain>`. */
  readonly pagesDomain: string;
  /** Internal artifact-content origin (IMMO_ARTIFACTS_LIVE_EDGE_URL); undefined keeps the push closed. */
  readonly target?: URL | undefined;
  readonly send?: LiveControlTransport;
  readonly now?: () => number;
  readonly attempts?: number;
  readonly backoffMs?: (attempt: number) => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
}

export function createLiveFencePusher(options: LiveFencePushOptions) {
  const send = options.send ?? nodeHttpControlTransport;
  const now = options.now ?? Date.now;
  const attempts = options.attempts ?? 3;
  const backoff = options.backoffMs ?? ((attempt: number) => 100 * 4 ** attempt);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (claims: Omit<LiveControlClaims, "v" | "kid" | "host" | "iat" | "exp">): Promise<void> => {
    if (!options.target || !options.pagesDomain || !options.kid) {
      throw new ArtifactOperationError("provider_unavailable", { publicDetails: { fence: "unconfigured" } });
    }
    // The edge scopes control to the artifact's own pages Host: same value in the claim and the Host header.
    const host = liveArtifactHost(claims.artifactId, options.pagesDomain);
    let lastStatus = 0;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(backoff(attempt - 1));
      const iat = Math.floor(now() / 1000);
      // Exactly the 10 CONTROL_FIELDS of the provider format, in a closed object.
      const token = options.signer.signControl({ v: 1, kid: options.kid, host, artifactId: claims.artifactId, op: claims.op,
        sessionId: claims.sessionId, invitationId: claims.invitationId, epoch: claims.epoch, iat, exp: iat + 60 });
      try {
        lastStatus = await send({ target: options.target, host, path: LIVE_CONTROL_PATH,
          headers: { [LIVE_CONTROL_HEADER]: token }, timeoutMs: options.timeoutMs ?? 5000 });
        if (lastStatus >= 200 && lastStatus < 300) return;
      } catch { lastStatus = 0; /* transport error, retried */ }
    }
    throw new ArtifactOperationError("provider_unavailable", { publicDetails: { fence: "push_failed", status: lastStatus } });
  };
}
export type LiveFencePush = ReturnType<typeof createLiveFencePusher>;

/** Revocation handler: sockets closed first, then the fence pushed; a push failure is surfaced. */
export interface LiveRevocationHooks {
  /** Cached controller grants (live-grant.ts) dropped with the sockets. */
  readonly grants?: { invalidate(artifactId: string): void; invalidateInvitation(artifactId: string, invitationId: string): void };
}

/**
 * A revoked invitation, as the generic package host port hands it over
 * (`invitations.onRevoked(e)`, live-invitations.ts): `epoch` is the NEW session epoch.
 */
export interface LiveInvitationRevocation { readonly artifactId: string; readonly invitationId: string; readonly epoch: number }

/**
 * Revocation: the proxied sockets are closed FIRST (synchronously) and the
 * cached grants dropped, then the control message is pushed (revoke_invitation
 * carries the NEW session epoch). A push failure is surfaced after the local
 * effects (the generic host port retries until 204).
 */
export function createLiveRevocation(deps: { readonly sockets: LiveSocketRegistry; readonly push: LiveFencePush } & LiveRevocationHooks) {
  return {
    async invitation(invitation: LiveInvitationRevocation) {
      const closed = deps.sockets.closeInvitation(invitation.artifactId, invitation.invitationId);
      deps.grants?.invalidateInvitation(invitation.artifactId, invitation.invitationId);
      await deps.push({ artifactId: invitation.artifactId, op: "revoke_invitation", sessionId: "",
        invitationId: invitation.invitationId, epoch: invitation.epoch });
      return { closed };
    },
    /**
     * Revokes a PACKAGE live session: closes its sockets, drops grants, then
     * pushes revoke_session for every CONTROLLER session id known for it (from
     * its open sockets, plus any given).
     */
    async session(artifactId: string, liveSessionId: string, edgeSessionIds: readonly string[] = []) {
      const local = deps.sockets.closeLiveSession(artifactId, liveSessionId);
      const edge = [...new Set([...edgeSessionIds, ...local.edgeSessionIds])];
      let closed = local.closed;
      for (const sessionId of edge) closed += deps.sockets.closeSession(artifactId, sessionId);
      deps.grants?.invalidate(artifactId);
      for (const sessionId of edge) await deps.push({ artifactId, op: "revoke_session", sessionId, invitationId: "", epoch: 0 });
      return { closed, pushed: edge.length };
    },
  };
}

/**
 * Live edge configuration (W9, preprod values in docs/operator/git-artifact-mode.md):
 * - IMMO_ARTIFACTS_LIVE_HOST_KEYS: HMAC keyring `kid=base64url[,kid=base64url]`,
 *   each key at least 32 bytes; rotation by kid overlap (old and new listed);
 * - IMMO_ARTIFACTS_LIVE_HOST_KID: the kid that signs now (preprod `immo-preprod-live-1`);
 * - IMMO_ARTIFACTS_LIVE_HOST: the pages domain; assertions and control
 *   messages claim `<artifactId>.<domain>` (preprod `pages.preprod.immo.sent-tech.ca`);
 * - IMMO_ARTIFACTS_LIVE_EDGE_URL: the internal artifact-content origin, used
 *   by the forward and the control push
 *   (preprod `http://artifact-content.sentropic-preprod.svc.cluster.local:8791`);
 * - IMMO_ARTIFACTS_LIVE_CONTROL_URL: superseded (W9 CORRECTIF: the control
 *   push goes to the internal Service, not the public pages origin); still
 *   validated so an existing manifest keeps booting, never used for transport.
 * Absent: no signer or no edge URL, every push refuses (fail-closed).
 */

export function parseLiveHostKeyring(raw: string | undefined): ReadonlyMap<string, Uint8Array> {
  const keys = new Map<string, Uint8Array>();
  for (const entry of (raw ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    const kid = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    const key = Buffer.from(value, "base64url");
    if (separator < 1 || !LIVE_KEY_ID.test(kid) || keys.has(kid) || key.byteLength < 32 ||
      key.toString("base64url") !== value.replace(/=+$/, "")) throw new Error("artifact_live_host_keys_invalid");
    keys.set(kid, new Uint8Array(key));
  }
  return keys;
}

export interface LiveEdgeConfig {
  readonly kid?: string | undefined;
  readonly key?: Uint8Array | undefined;
  readonly host?: string | undefined;
  /** Superseded; validated only. */
  readonly controlUrl?: URL | undefined;
  /** Internal artifact-content origin (forward and control push). */
  readonly edgeUrl?: URL | undefined;
}

export const LIVE_EDGE_URL_ENV = "IMMO_ARTIFACTS_LIVE_EDGE_URL" as const;

/** Internal artifact-content origin: http(s), no credentials, no path, query or fragment. */
export function parseLiveEdgeUrl(raw: string | undefined): URL | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("artifact_live_edge_url_invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search ||
    url.hash) throw new Error("artifact_live_edge_url_invalid");
  return url;
}

export function readLiveEdgeConfig(env: NodeJS.ProcessEnv): LiveEdgeConfig {
  const keys = parseLiveHostKeyring(env.IMMO_ARTIFACTS_LIVE_HOST_KEYS);
  const kid = env.IMMO_ARTIFACTS_LIVE_HOST_KID?.trim() || undefined;
  if (kid !== undefined && !keys.has(kid)) throw new Error("artifact_live_host_kid_invalid");
  const control = env.IMMO_ARTIFACTS_LIVE_CONTROL_URL?.trim();
  const controlUrl = control ? new URL(control) : undefined;
  if (controlUrl && (controlUrl.protocol !== "https:" || controlUrl.pathname !== LIVE_CONTROL_PATH || controlUrl.search)) {
    throw new Error("artifact_live_control_url_invalid");
  }
  return { kid, key: kid ? keys.get(kid) : undefined, host: env.IMMO_ARTIFACTS_LIVE_HOST?.trim().toLowerCase() || undefined,
    controlUrl, edgeUrl: parseLiveEdgeUrl(env[LIVE_EDGE_URL_ENV]) };
}

/** Fence pusher and revocation from the configuration and the provider signer (fail-closed when incomplete). */
export async function composeLiveEdgeRevocation(config: LiveEdgeConfig, sockets: LiveSocketRegistry,
  send?: LiveControlTransport): Promise<ReturnType<typeof createLiveRevocation>> {
  return composeLiveEdgeRevocationWith(config, sockets, await loadLiveSigner(config.key), send);
}

/** The control pusher of the configuration (fail-closed when kid, host or edge URL are missing). */
export function composeLiveEdgeRevocationPush(config: LiveEdgeConfig, signer: LiveAssertionSigner,
  send?: LiveControlTransport): LiveFencePush {
  return createLiveFencePusher({ signer, kid: config.kid ?? "", pagesDomain: config.host ?? "",
    target: config.kid && config.host ? config.edgeUrl : undefined, ...(send ? { send } : {}) });
}

export function composeLiveEdgeRevocationWith(config: LiveEdgeConfig, sockets: LiveSocketRegistry, signer: LiveAssertionSigner,
  send?: LiveControlTransport, hooks: LiveRevocationHooks = {}): ReturnType<typeof createLiveRevocation> {
  return createLiveRevocation({ sockets, push: composeLiveEdgeRevocationPush(config, signer, send), ...hooks });
}
