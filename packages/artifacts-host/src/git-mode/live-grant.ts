import { createHash } from "node:crypto";
import type { LiveIdentity, LiveWorkerPort } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { builderBaseUrl } from "./build-api.js";
import { stageLiveDraft, type LiveDraftSource } from "./live-draft-stager.js";
import { resolveBuilderBinding, type BuilderBindingSource } from "./builder-binding.js";
import type { ServiceTokenSource } from "./service-token.js";

/**
 * Controller clients of the live edge (W9 CORRECTIF of 2026-11-07, verified
 * on Sentropic feat/alive-w7 @ e14fb6b9e), on the builder mount
 * `<IMMO_ARTIFACTS_BUILDER_URL>/v1/live/*` with the same S2S authentication
 * as `/v1/builds` (OAuth client_credentials, scope `artifacts:builder`; the
 * storage scope is taken from the credential binding, never from the body).
 *
 * - Route grant: `POST v1/live/grant` with
 *   `{artifactId, access:'read', actor:{principalId, invitation?:{id, epoch, expiresAt(ms)}}, invitation:{epoch, expiresAt(ms)|null}}`;
 *   `invitation` is the SESSION state (identical for every request of the
 *   session, owner included: epoch shared by all active invitations, latest
 *   active expiry or null), never lowered; 200 `{grant}`, 409
 *   `{error:'invalid_phase'|'stale_session'|'stale_invitation'}`, 403
 *   `{error:'access_denied'}`. The host signs the grant UNCHANGED (plus kid,
 *   host, iat, exp). A granted answer is cached at most 30 s per
 *   (artifactId, principal, invitation); a 409, an edge 404 on a live path or
 *   a revocation invalidates it.
 * - LiveWorkerPort: `POST v1/live/reconcile` (BridgeAck, body with `binding: {repoId, branch, subPath}`
 *   read from the package git binding of that artifact and generation, never caller input, no such
 *   binding: git_not_attached before any call, and with the same
 *   session `invitation` state) and `POST v1/live/stop` (204). The fences
 *   sent are the package store ones.
 *
 * Nothing answers on the Sentropic side before the M4-R wagon: every failure
 * is fail-closed (grant: `unavailable`, release served; worker: typed refusal).
 */
export const LIVE_GRANT_CACHE_MS = 30_000;

/** Session invitation state of the grant and reconcile bodies: `{epoch, expiresAt: ms | null}`. */
export interface LiveSessionInvitationState { readonly epoch: number; readonly expiresAt: number | null }
/**
 * Session state while the invitations are not qualified (or no live service is
 * composed yet): no invitation, epoch 0. Qualified: `liveInvitationState(identity)`
 * from @sentropic/artifacts.
 */
export const NO_LIVE_INVITATIONS: LiveSessionInvitationState = Object.freeze({ epoch: 0, expiresAt: null });
const LIVE_GRANT_CACHE_MAX = 1024;
const MAX_REVISION = 256;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Controller answers are small JSON documents; anything larger is refused. */
const MAX_ANSWER_BYTES = 64 * 1024;

/** The 13 controller fields of a route grant (A-LIVE §8.2, W9 claims without kid, host, iat, exp). */
export interface LiveGrant {
  readonly storageScopeId: string;
  readonly artifactId: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly routeEpoch: number;
  readonly podUid: string;
  readonly podName: string;
  readonly sourceRevision: string;
  readonly principalId: string;
  readonly role: "binding_owner" | "invitee";
  readonly invitationId: string;
  readonly invitationEpoch: number;
  readonly invitationExp: number;
}

export interface LiveGrantRequest {
  readonly artifactId: string;
  /** Binding generation of the session (not sent: keys the epoch floor). */
  readonly bindingGeneration: number;
  readonly principalId: string;
  /** Present for an invitee only, after immo's own invitation check; its epoch is the session epoch. */
  readonly invitation?: { readonly id: string; readonly expiresAt: number } | undefined;
  /** Session invitation state held by immo (authoritative on invitations). */
  readonly session: LiveSessionInvitationState;
}

export type LiveGrantOutcome =
  | { readonly kind: "granted"; readonly grant: LiveGrant }
  | { readonly kind: "conflict"; readonly error: "invalid_phase" | "stale_session" | "stale_invitation" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };

/** Builder pod name, computed exactly as the edge recomputes it; never stored. */
export function livePodName(storageScopeId: string, artifactId: string): string {
  return `artifact-${createHash("sha256").update(JSON.stringify([storageScopeId, artifactId])).digest("hex").slice(0, 40)}`;
}

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isText = (value: unknown, max = 256): value is string => typeof value === "string" && value.length >= 1 && value.length <= max;

/**
 * Strict reading of a controller grant against the request: every field
 * typed, the pod name recomputed, the principal, artifact and role bound to
 * the request. Undefined refuses (the release is served).
 */
export function parseLiveGrant(raw: unknown, request: LiveGrantRequest, sessionEpoch = request.session.epoch): LiveGrant | undefined {
  const record = raw as Record<string, unknown> | null;
  if (!record || typeof record !== "object" || Array.isArray(record)) return undefined;
  const { storageScopeId, artifactId, sessionId, generation, routeEpoch, podUid, podName, sourceRevision, principalId, role,
    invitationId, invitationEpoch, invitationExp } = record;
  if (!isText(storageScopeId) || typeof artifactId !== "string" || artifactId !== request.artifactId ||
    typeof sessionId !== "string" || !ID.test(sessionId) ||
    !isCount(generation) || generation < 1 || !isCount(routeEpoch) || !isText(podUid) || !isText(sourceRevision, MAX_REVISION) ||
    typeof podName !== "string" || podName !== livePodName(storageScopeId, artifactId) ||
    typeof principalId !== "string" || principalId !== request.principalId ||
    typeof invitationId !== "string" || !isCount(invitationEpoch) || !isCount(invitationExp)) return undefined;
  const invitation = request.invitation;
  if (role === "binding_owner") {
    if (invitation || invitationId !== "" || invitationEpoch !== 0 || invitationExp !== 0) return undefined;
  } else if (role === "invitee") {
    if (!invitation || invitationId !== invitation.id || invitationEpoch !== sessionEpoch || invitationEpoch < 1 ||
      invitationExp < 1 || invitationExp > Math.floor(invitation.expiresAt / 1000)) return undefined;
  } else return undefined;
  return { storageScopeId, artifactId, sessionId, generation, routeEpoch, podUid, podName, sourceRevision,
    principalId, role, invitationId, invitationEpoch, invitationExp };
}

export interface LiveControllerClientOptions {
  /** Builder base URL (IMMO_ARTIFACTS_BUILDER_URL); absent keeps every call closed. */
  readonly baseUrl?: string | undefined;
  /** S2S identity, scope `artifacts:builder`. */
  readonly identity?: ServiceTokenSource | undefined;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly cacheMs?: number;
}

async function post(options: LiveControllerClientOptions, base: URL, path: string, body: unknown) {
  const fetcher = options.fetch ?? fetch;
  const authorization = await options.identity!.authorization();
  const response = await fetcher(new URL(path, base), { method: "POST", redirect: "error",
    headers: { "content-type": "application/json", authorization }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 5000) });
  return { status: response.status, payload: await boundedJson(response) };
}

/** Reads the body to completion (no connection held) and parses at most MAX_ANSWER_BYTES of JSON. */
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ANSWER_BYTES) { await reader.cancel().catch(() => undefined); return undefined; }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : undefined;
  } catch { return undefined; }
}

/**
 * Session epoch floor: the epoch sent for a binding generation is never
 * lower than one already sent (the controller answers 409 stale_invitation).
 */
export function createEpochFloor(max = 4096) {
  const floors = new Map<string, number>();
  return (artifactId: string, bindingGeneration: number, epoch: number) => {
    const key = JSON.stringify([artifactId, bindingGeneration]);
    const floor = Math.max(floors.get(key) ?? 0, epoch);
    if (!floors.has(key) && floors.size >= max) floors.delete(floors.keys().next().value!);
    floors.set(key, floor);
    return floor;
  };
}

const sessionBody = (session: LiveSessionInvitationState, epoch: number) => ({ epoch,
  expiresAt: session.expiresAt === null ? null : session.expiresAt });

const cacheKey = (artifactId: string, principalId: string, invitationId: string, epoch: number, expiresAt: number | null) =>
  JSON.stringify([artifactId, principalId, invitationId, epoch, expiresAt]);

export function createLiveGrantClient(options: LiveControllerClientOptions) {
  const base = options.baseUrl !== undefined && options.identity !== undefined ? builderBaseUrl(options.baseUrl) : undefined;
  const now = options.now ?? Date.now;
  const ttl = Math.min(options.cacheMs ?? LIVE_GRANT_CACHE_MS, LIVE_GRANT_CACHE_MS);
  const cache = new Map<string, { grant: LiveGrant; until: number; artifactId: string; principalId: string; invitationId: string }>();
  const floor = createEpochFloor();
  const drop = (match: (entry: { artifactId: string; principalId: string; invitationId: string }) => boolean) => {
    for (const [key, entry] of [...cache]) if (match(entry)) cache.delete(key);
  };
  return {
    configured: () => base !== undefined,
    async grant(request: LiveGrantRequest): Promise<LiveGrantOutcome> {
      if (!base) return { kind: "unavailable" };
      const invitationId = request.invitation?.id ?? "";
      const epoch = floor(request.artifactId, request.bindingGeneration, request.session.epoch);
      const key = cacheKey(request.artifactId, request.principalId, invitationId, epoch, request.session.expiresAt);
      const cached = cache.get(key);
      if (cached && cached.until > now()) return { kind: "granted", grant: cached.grant };
      cache.delete(key);
      const body = { artifactId: request.artifactId, access: "read",
        actor: { principalId: request.principalId,
          ...(request.invitation ? { invitation: { id: request.invitation.id, epoch, expiresAt: request.invitation.expiresAt } } : {}) },
        invitation: sessionBody(request.session, epoch) };
      let answer: { status: number; payload: unknown };
      try { answer = await post(options, base, "v1/live/grant", body); } catch { return { kind: "unavailable" }; }
      const payload = answer.payload as { grant?: unknown; error?: unknown } | undefined;
      if (answer.status === 409) {
        drop((entry) => entry.artifactId === request.artifactId);
        return payload?.error === "invalid_phase" || payload?.error === "stale_session" || payload?.error === "stale_invitation"
          ? { kind: "conflict", error: payload.error } : { kind: "unavailable" };
      }
      if (answer.status === 403) {
        drop((entry) => entry.artifactId === request.artifactId && entry.principalId === request.principalId);
        return { kind: "denied" };
      }
      if (answer.status !== 200) return { kind: "unavailable" };
      const grant = parseLiveGrant(payload?.grant, request, epoch);
      if (!grant) return { kind: "unavailable" };
      if (cache.size >= LIVE_GRANT_CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, { grant, until: now() + ttl, artifactId: request.artifactId, principalId: request.principalId, invitationId });
      return { kind: "granted", grant };
    },
    /** Edge 404 on a live path, a 409 or a revocation: the next request asks the controller again. */
    invalidate(artifactId: string, principalId?: string) {
      drop((entry) => entry.artifactId === artifactId && (principalId === undefined || entry.principalId === principalId));
    },
    invalidateInvitation(artifactId: string, invitationId: string) {
      drop((entry) => entry.artifactId === artifactId && entry.invitationId === invitationId);
    },
    size: () => cache.size,
  };
}
export type LiveGrantClient = ReturnType<typeof createLiveGrantClient>;

/** Package-store fences of the current live session (the package validates the ACK against them). */
export interface LiveWorkerFences {
  current(identity: LiveIdentity): Promise<{ ownerId: string; liveSessionId: string; leaseEpoch: number; routeEpoch: number } | undefined>;
}

export interface BridgeAck {
  readonly liveSessionId: string; readonly leaseEpoch: number; readonly routeEpoch: number;
  readonly revision: string; readonly ready: boolean;
}

function parseBridgeAck(raw: unknown): BridgeAck {
  const record = raw as Record<string, unknown> | null | undefined;
  if (!record || typeof record !== "object" || typeof record.liveSessionId !== "string" || !ID.test(record.liveSessionId) ||
    !isCount(record.leaseEpoch) || !isCount(record.routeEpoch) || !isText(record.revision, MAX_REVISION) ||
    typeof record.ready !== "boolean") throw new ArtifactOperationError("provider_unavailable");
  return { liveSessionId: record.liveSessionId, leaseEpoch: record.leaseEpoch, routeEpoch: record.routeEpoch,
    revision: record.revision, ready: record.ready };
}

/**
 * HTTP LiveWorkerPort of the Sentropic controller (composed as the package
 * LiveService `worker`). Fail-closed: unconfigured answers
 * `builder_unavailable`, any transport error, non-200 reconcile, non-204
 * stop or malformed ACK answers `provider_unavailable` (the package keeps the
 * durable intent for the controller's fenced reconciliation).
 */
export function createLiveWorkerClient(options: LiveControllerClientOptions & { readonly fences: LiveWorkerFences;
  /** Package git binding store: source of the `binding` coordinates of the reconcile body. */
  readonly bindings?: BuilderBindingSource | undefined;
  /** Session invitation state of the live session (same as the grant body). */
  readonly sessionState: (identity: LiveIdentity, liveSessionId: string) => Promise<LiveSessionInvitationState>;
  /** Current durable draft of the package store, staged to the builder (pages then seal) before every reconcile. */
  readonly drafts: LiveDraftSource;
}): LiveWorkerPort {
  const base = options.baseUrl !== undefined && options.identity !== undefined ? builderBaseUrl(options.baseUrl) : undefined;
  const floor = createEpochFloor();
  const call = async (path: string, body: unknown) => {
    if (!base) throw new ArtifactOperationError("builder_unavailable");
    try { return await post(options, base, path, body); } catch (error) {
      if (error instanceof ArtifactOperationError) throw error;
      throw new ArtifactOperationError("provider_unavailable");
    }
  };
  return {
    async reconcile(identity) {
      if (!base) throw new ArtifactOperationError("builder_unavailable");
      const binding = await resolveBuilderBinding(options.bindings, identity);
      const fences = await options.fences.current(identity);
      if (!fences) throw new ArtifactOperationError("provider_unavailable");
      await stageLiveDraft(options.drafts, identity, call);
      const session = await options.sessionState(identity, fences.liveSessionId);
      const epoch = floor(identity.artifactId, identity.bindingGeneration, session.epoch);
      const answer = await call("v1/live/reconcile", { artifactId: identity.artifactId, bindingGeneration: identity.bindingGeneration,
        ownerId: fences.ownerId, liveSessionId: fences.liveSessionId, leaseEpoch: fences.leaseEpoch, routeEpoch: fences.routeEpoch,
        binding, invitation: sessionBody(session, epoch) });
      if (answer.status !== 200) throw new ArtifactOperationError("provider_unavailable");
      return parseBridgeAck(answer.payload);
    },
    async stop(input) {
      const answer = await call("v1/live/stop", { artifactId: input.artifactId, bindingGeneration: input.bindingGeneration,
        liveSessionId: input.liveSessionId, leaseEpoch: input.leaseEpoch });
      if (answer.status !== 204) throw new ArtifactOperationError("provider_unavailable");
    },
  };
}
