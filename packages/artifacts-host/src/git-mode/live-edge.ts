import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import type { LiveInvitation } from "./live-authority.js";
import { loadLiveHost, type LiveHostModule } from "./live-host-adapter.js";

/**
 * Host side of the live edge (M4-I, W9 contract).
 *
 * - Assertions and control messages are signed ONLY by the provider
 *   subpath `@sentropic/artifacts/live-host` (0.2.20, live-host-adapter.ts).
 *   immo carries no crypto of its own for them: until the subpath is
 *   published the signer adapter fails closed.
 * - Revocation (invitation or session): the host first closes every proxied
 *   browser socket it holds for that invitee or session (the host owns the
 *   browser socket), then pushes the revocation to artifact-content's fence
 *   channel: `POST /_live-control/v1` with the signed `x-live-host-control`
 *   header, answered 204 (any refusal is a bare 404). Every response body is
 *   read to completion (no connection held between attempts); a non-2xx
 *   answer or a transport error is retried, and the final failure is
 *   surfaced with the last status, the sockets being already closed.
 */
export const LIVE_CONTROL_PATH = "/_live-control/v1" as const;
export const LIVE_CONTROL_HEADER = "x-live-host-control" as const;
export const LIVE_ASSERTION_HEADER = "x-live-host-assertion" as const;

export interface LiveAssertionClaims {
  v: 1; kid: string; host: string; artifactId: string; storageScopeId: string; sessionId: string;
  generation: number; routeEpoch: number; podUid: string; podName: string; sourceRevision: number;
  principalId: string; role: "binding_owner" | "invitee"; invitationId: string; invitationEpoch: number; invitationExp: number;
  iat: number; exp: number;
}
export interface LiveControlClaims {
  v: 1; kid: string; host: string; artifactId: string; op: "revoke_session" | "revoke_invitation" | "fence";
  sessionId: string; invitationId: string; epoch: number; generation: number; routeEpoch: number; iat: number; exp: number;
}

export interface LiveAssertionSigner {
  signAssertion(claims: LiveAssertionClaims): string;
  signControl(claims: LiveControlClaims): string;
}

export const FAIL_CLOSED_LIVE_SIGNER: LiveAssertionSigner = Object.freeze({
  signAssertion(): never { throw new ArtifactOperationError("provider_unavailable"); },
  signControl(): never { throw new ArtifactOperationError("provider_unavailable"); },
});

/** Provider signer bound to the host key; fail-closed when the export is absent (0.2.18). */
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
export interface LiveSocketKey { readonly artifactId: string; readonly sessionId: string; readonly principalId: string;
  readonly invitationId?: string }

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
  return {
    register(key: LiveSocketKey, socket: LiveSocket) { sockets.set(socket, key); return () => { sockets.delete(socket); }; },
    size: () => sockets.size,
    closeInvitation: (artifactId: string, invitationId: string) =>
      close((key) => key.artifactId === artifactId && key.invitationId === invitationId, "invitation_revoked"),
    closeSession: (artifactId: string, sessionId: string) =>
      close((key) => key.artifactId === artifactId && key.sessionId === sessionId, "session_revoked"),
  };
}
export type LiveSocketRegistry = ReturnType<typeof createLiveSocketRegistry>;

export interface LiveFencePushOptions {
  readonly signer: LiveAssertionSigner;
  readonly kid: string;
  /** Host-owned pages domain the edge is configured for. */
  readonly host: string;
  /** Internal control URL of the live edge for one artifact; undefined keeps the push closed. */
  readonly controlUrl?: ((artifactId: string) => URL) | undefined;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly attempts?: number;
  readonly backoffMs?: (attempt: number) => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function createLiveFencePusher(options: LiveFencePushOptions) {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const attempts = options.attempts ?? 3;
  const backoff = options.backoffMs ?? ((attempt: number) => 100 * 4 ** attempt);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (claims: Omit<LiveControlClaims, "v" | "kid" | "host" | "iat" | "exp">): Promise<void> => {
    if (!options.controlUrl) throw new ArtifactOperationError("provider_unavailable", { publicDetails: { fence: "unconfigured" } });
    const url = options.controlUrl(claims.artifactId);
    let lastStatus = 0;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(backoff(attempt - 1));
      const iat = Math.floor(now() / 1000);
      const token = options.signer.signControl({ v: 1, kid: options.kid, host: options.host, iat, exp: iat + 60, ...claims });
      try {
        const response = await fetcher(url, { method: "POST", redirect: "error", headers: { [LIVE_CONTROL_HEADER]: token },
          signal: AbortSignal.timeout(5000) });
        lastStatus = response.status;
        // Drain the body (bounded by the edge's empty answers) before deciding.
        await response.arrayBuffer().catch(() => undefined);
        if (response.ok) return;
      } catch { lastStatus = 0; /* transport error, retried */ }
    }
    throw new ArtifactOperationError("provider_unavailable", { publicDetails: { fence: "push_failed", status: lastStatus } });
  };
}
export type LiveFencePush = ReturnType<typeof createLiveFencePusher>;

/** Revocation handler: sockets closed first, then the fence pushed; a push failure is surfaced. */
export function createLiveRevocation(deps: { readonly sockets: LiveSocketRegistry; readonly push: LiveFencePush }) {
  return {
    async invitation(invitation: LiveInvitation) {
      const closed = deps.sockets.closeInvitation(invitation.artifactId, invitation.invitationId);
      await deps.push({ artifactId: invitation.artifactId, op: "revoke_invitation", sessionId: "",
        invitationId: invitation.invitationId, epoch: invitation.epoch, generation: 0, routeEpoch: 0 });
      return { closed };
    },
    async session(artifactId: string, sessionId: string) {
      const closed = deps.sockets.closeSession(artifactId, sessionId);
      await deps.push({ artifactId, op: "revoke_session", sessionId, invitationId: "", epoch: 0, generation: 0, routeEpoch: 0 });
      return { closed };
    },
  };
}
