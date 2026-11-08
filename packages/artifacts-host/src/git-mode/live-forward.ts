import type pg from "pg";
import { MAX_ASSERTION_SECONDS, type LiveAssertionClaims } from "@sentropic/artifacts/live-host";
import { composeGitAccess, readGitModeConfig } from "./compose.js";
import type { GitModeStage } from "./flag.js";
import {
  createLiveReaderGate, createPostgresLiveInvitationStore, createPostgresLiveSessions, type LiveReaderRole,
} from "./live-authority.js";
import {
  composeLiveEdgeRevocationWith, createLiveSocketRegistry, liveSignerFrom, readLiveEdgeConfig, type LiveControlTransport,
  type LiveSocketRegistry,
} from "./live-edge.js";
import { createLiveGrantClient, type LiveGrant, type LiveGrantClient, type LiveGrantOutcome, type LiveGrantRequest } from "./live-grant.js";
import type { LiveHostModule } from "./live-host-adapter.js";
import { SERVICE_SCOPE_BUILDER, serviceTokenSource } from "./service-token.js";

/**
 * Live edge forward, host side (A-LIVE §8.2, W9 contract of 2026-11-07 and
 * its CORRECTIF verified on Sentropic feat/alive-w7 @ e14fb6b9e).
 *
 * The immo content host (radar-api, which serves `*.<pages domain>`) runs the
 * §8.2 gate (binding owner, or an active invitee, both with current code
 * rights, plus a live reader consent), then serves LIVE only when:
 * 1. the package live record is ready for the current revision (phase LIVE
 *    and appliedRevision = the draft revision), and
 * 2. the controller route grant (`POST v1/live/grant`, live-grant.ts) answers
 *    200 with `grant.sourceRevision` = that revision.
 * Otherwise the release is served (existing path). The assertion signs the
 * controller grant UNCHANGED plus kid, host, iat and exp (the package runtime
 * fields are never used; podUid is the controller's).
 *
 * Two switches, both required: the git mode stage `live` AND
 * IMMO_ARTIFACTS_LIVE_EDGE_ENABLED=1 (off by default: nothing answers on the
 * Sentropic side before the M4-R wagon and GB4-P). With the switches on and
 * the configuration incomplete or invalid, the forward stays composed in an
 * unavailable state: gated principals keep the release, live paths show
 * « live indisponible », nothing is forwarded.
 *
 * Configuration: IMMO_ARTIFACTS_LIVE_EDGE_ENABLED (`1`), IMMO_ARTIFACTS_LIVE_EDGE_URL
 * (internal artifact-content origin), IMMO_ARTIFACTS_LIVE_HOST_KEYS / _KID
 * (HMAC keyring, kid `immo-preprod-live-1`), IMMO_ARTIFACTS_LIVE_HOST (pages
 * domain, must equal the content base), IMMO_ARTIFACTS_BUILDER_URL and the
 * IMMO_ARTIFACTS_SERVICE_OAUTH_* client (scope `artifacts:builder`).
 */
export const LIVE_EDGE_FLAG_ENV = "IMMO_ARTIFACTS_LIVE_EDGE_ENABLED" as const;
/** HTTP: one fresh assertion per request. */
export const LIVE_HTTP_ASSERTION_SECONDS = 60;
/** Websocket: the edge maximum; capped at the invitation expiry for an invitee. */
export const LIVE_WS_ASSERTION_SECONDS = MAX_ASSERTION_SECONDS;

/** The new flag, on top of stage `live`: `1` only; anything else is off. */
export function readLiveEdgeEnabled(env: NodeJS.ProcessEnv, stage: GitModeStage): boolean {
  return stage === "live" && env[LIVE_EDGE_FLAG_ENV]?.trim() === "1";
}

/** Package live record readiness of a binding generation. */
export interface LiveReadiness { readonly revision: string; readonly ready: boolean }
export interface LiveReadinessPort {
  current(storageScopeId: string, artifactId: string, bindingGeneration: number): Promise<LiveReadiness | undefined>;
}

interface Queryable { query<R extends object>(text: string, values: unknown[]): Promise<{ rows: R[] }> }

/** Ready = phase LIVE and appliedRevision equal to the draft revision (the package records it only on a matching ACK). */
export function createPostgresLiveReadiness(pool: Queryable): LiveReadinessPort {
  return {
    async current(storageScopeId, artifactId, bindingGeneration) {
      const result = await pool.query<{ revision: string | null; phase: string | null; applied: string | null;
        tombstone: string | null }>(`SELECT record->>'revision' AS revision, record->'runtime'->>'phase' AS phase,
        record->'runtime'->>'appliedRevision' AS applied, record->>'tombstone' AS tombstone
        FROM artifacts.live_drafts WHERE storage_scope_id = $1 AND artifact_id = $2 AND binding_generation = $3`,
      [storageScopeId, artifactId, bindingGeneration]);
      const row = result.rows[0];
      if (!row?.revision) return undefined;
      return { revision: row.revision, ready: row.tombstone === null && row.phase === "LIVE" && row.applied === row.revision };
    },
  };
}

/**
 * The 18 closed claims: the 13 grant fields unchanged, plus v, kid, host,
 * iat, exp. Invitee: exp capped at the invitation expiry. Undefined refuses.
 */
export function liveAssertionFromGrant(input: { readonly grant: LiveGrant; readonly kid: string; readonly host: string;
  readonly nowMs: number; readonly lifetimeSeconds: number }): LiveAssertionClaims | undefined {
  const { grant } = input;
  const iat = Math.floor(input.nowMs / 1000);
  const exp = grant.role === "invitee" ? Math.min(iat + input.lifetimeSeconds, grant.invitationExp) : iat + input.lifetimeSeconds;
  if (!input.kid || exp <= iat) return undefined;
  return { v: 1, kid: input.kid, host: input.host.toLowerCase(), artifactId: grant.artifactId,
    storageScopeId: grant.storageScopeId, sessionId: grant.sessionId, generation: grant.generation, routeEpoch: grant.routeEpoch,
    podUid: grant.podUid, podName: grant.podName, sourceRevision: grant.sourceRevision, principalId: grant.principalId,
    role: grant.role, invitationId: grant.invitationId, invitationEpoch: grant.invitationEpoch, invitationExp: grant.invitationExp,
    iat, exp };
}

/** Grant request built from the §8.2 gate role (the floor is immo's current invitation epoch). */
export function grantRequestFor(artifactId: string, role: LiveReaderRole): LiveGrantRequest {
  if (role.role === "binding_owner") return { artifactId, principalId: role.principalId, invitationEpoch: 0 };
  return { artifactId, principalId: role.principalId, invitationEpoch: role.epoch,
    invitation: { id: role.invitationId, epoch: role.epoch, expiresAt: Date.parse(role.expiresAt) } };
}

export interface LiveEdgeForwardConfig {
  readonly kid: string;
  readonly key: Uint8Array;
  /** artifact-content internal origin. */
  readonly target: URL;
}

export type LiveEdgeForwardResolution =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly config: LiveEdgeForwardConfig }
  | { readonly enabled: true; readonly config?: undefined; readonly reason: string };

/** Never throws: an invalid configuration yields the unavailable state. */
export function readLiveEdgeForward(env: NodeJS.ProcessEnv, stage: GitModeStage, contentBase: string): LiveEdgeForwardResolution {
  if (!readLiveEdgeEnabled(env, stage)) return { enabled: false };
  let edge;
  try { edge = readLiveEdgeConfig(env); } catch { return { enabled: true, reason: "live_edge_config_invalid" }; }
  if (!edge.kid || !edge.key) return { enabled: true, reason: "live_edge_key_missing" };
  if (edge.host !== contentBase.trim().toLowerCase()) return { enabled: true, reason: "live_edge_host_mismatch" };
  if (!edge.edgeUrl) return { enabled: true, reason: "live_edge_url_missing" };
  return { enabled: true, config: { kid: edge.kid, key: edge.key, target: edge.edgeUrl } };
}

export type LiveReaderGate = (storageScopeId: string, artifactId: string, principalId: string) => Promise<LiveReaderRole | null>;
/** Live reader consent of the principal for this artifact, re-read on every admission. */
export type LiveConsentCheck = (principalId: string, artifactId: string) => Promise<boolean>;

export type LiveAdmission =
  /** Outside the §8.2 gate: the request is not a live candidate at all. */
  | { readonly kind: "none" }
  /** Gated, but not live now (not ready, grant refused or mismatched): the release is served. */
  | { readonly kind: "release"; readonly reason: string }
  | { readonly kind: "live"; readonly claims: LiveAssertionClaims; readonly grant: LiveGrant };

/** Ports the radar-api content host needs for the forward. */
export interface LiveEdgePorts {
  readonly storageScopeId: string;
  readonly resolution: Exclude<LiveEdgeForwardResolution, { enabled: false }>;
  readonly gate: LiveReaderGate;
  readonly consent: LiveConsentCheck;
  readonly readiness: LiveReadinessPort;
  readonly grants: Pick<LiveGrantClient, "grant" | "invalidate" | "invalidateInvitation">;
  readonly signAssertion: (claims: LiveAssertionClaims) => string;
  /** Proxied browser sockets, shared with the revocation below. */
  readonly sockets: LiveSocketRegistry;
  readonly revocation: ReturnType<typeof composeLiveEdgeRevocationWith>;
}

/**
 * §8.2 gate, readiness and controller grant, in this order. Throws only on a
 * gate/store failure (the caller keeps the release, or « live indisponible »
 * on a live path).
 */
export async function admitLive(ports: Pick<LiveEdgePorts, "storageScopeId" | "gate" | "consent" | "readiness" | "grants">,
  input: { readonly host: string; readonly artifactId: string; readonly principalId: string; readonly kid: string;
    readonly nowMs: number; readonly lifetimeSeconds: number }): Promise<LiveAdmission> {
  const role = await ports.gate(ports.storageScopeId, input.artifactId, input.principalId);
  if (!role || role.principalId !== input.principalId) return { kind: "none" };
  if (!await ports.consent(input.principalId, input.artifactId)) return { kind: "none" };
  const readiness = await ports.readiness.current(ports.storageScopeId, input.artifactId, role.bindingGeneration);
  if (!readiness?.ready) return { kind: "release", reason: "not_ready" };
  let outcome: LiveGrantOutcome;
  try { outcome = await ports.grants.grant(grantRequestFor(input.artifactId, role)); } catch { outcome = { kind: "unavailable" }; }
  if (outcome.kind !== "granted") {
    return { kind: "release", reason: outcome.kind === "conflict" ? `grant_${outcome.error}` : `grant_${outcome.kind}` };
  }
  const { grant } = outcome;
  if (grant.sourceRevision !== readiness.revision || grant.storageScopeId !== ports.storageScopeId ||
    grant.generation !== role.bindingGeneration || grant.role !== role.role) {
    // A grant for another revision or generation is never signed; ask again next time.
    ports.grants.invalidate(input.artifactId, input.principalId);
    return { kind: "release", reason: "grant_mismatch" };
  }
  const claims = liveAssertionFromGrant({ grant, kid: input.kid, host: input.host, nowMs: input.nowMs,
    lifetimeSeconds: input.lifetimeSeconds });
  return claims ? { kind: "live", claims, grant } : { kind: "release", reason: "invitation_expired" };
}

/** Composes the gate, readiness, grant client, signer and revocation; undefined while the switches are off. */
export function composeLiveEdgePorts(input: {
  readonly pool: pg.Pool; readonly storageScopeId: string; readonly env: NodeJS.ProcessEnv; readonly stage: GitModeStage;
  readonly contentBase: string; readonly module: LiveHostModule | undefined;
  /** Live reader consent; absent refuses every principal (fail-closed). */
  readonly consent?: LiveConsentCheck | undefined;
  readonly fetch?: typeof fetch;
  readonly send?: LiveControlTransport;
}): LiveEdgePorts | undefined {
  const resolution = readLiveEdgeForward(input.env, input.stage, input.contentBase);
  if (!resolution.enabled) return undefined;
  const gitConfig = readGitModeConfig(input.env);
  const { bindings, registry, codeRights } = composeGitAccess({ pool: input.pool, storageScopeId: input.storageScopeId,
    config: gitConfig });
  const gate = createLiveReaderGate({ bindings, registry, codeRights,
    invitations: createPostgresLiveInvitationStore(input.pool), sessions: createPostgresLiveSessions(input.pool) });
  const grants = createLiveGrantClient({ baseUrl: gitConfig.builderUrl,
    identity: serviceTokenSource(gitConfig.service ?? {}, SERVICE_SCOPE_BUILDER, input.fetch),
    ...(input.fetch ? { fetch: input.fetch } : {}) });
  const signer = liveSignerFrom(input.module, resolution.config?.key);
  const sockets = createLiveSocketRegistry();
  let edge;
  try { edge = readLiveEdgeConfig(input.env); } catch { edge = {}; }
  const revocation = composeLiveEdgeRevocationWith(resolution.config ? edge : {}, sockets, signer, input.send, grants);
  return { storageScopeId: input.storageScopeId, resolution, gate, consent: input.consent ?? (async () => false),
    readiness: createPostgresLiveReadiness(input.pool), grants, signAssertion: (claims) => signer.signAssertion(claims),
    sockets, revocation };
}
