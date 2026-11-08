import type pg from "pg";
import { MAX_ASSERTION_SECONDS, type LiveAssertionClaims } from "@sentropic/artifacts/live-host";
import { composeGitAccess, readGitModeConfig } from "./compose.js";
import type { GitModeStage } from "./flag.js";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import {
  createLiveInvitationService, createLiveReaderGate, createPostgresLiveInvitationStore, createPostgresLiveSessions,
  createLiveSessionStatePort, type LiveReaderRole, type LiveSessionInvitationState, type LiveSessionStatePort,
} from "./live-authority.js";
import {
  createPostgresLiveAuthorizationStore, isLiveAuthorizationValid, type LiveAuthorizationStore,
} from "./live-authorizations.js";
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
export interface LiveReadiness { readonly revision: string; readonly ready: boolean; readonly liveSessionId?: string | undefined }
export interface LiveReadinessPort {
  current(storageScopeId: string, artifactId: string, bindingGeneration: number): Promise<LiveReadiness | undefined>;
}

interface Queryable { query<R extends object>(text: string, values: unknown[]): Promise<{ rows: R[] }> }

/** Ready = phase LIVE and appliedRevision equal to the draft revision (the package records it only on a matching ACK). */
export function createPostgresLiveReadiness(pool: Queryable): LiveReadinessPort {
  return {
    async current(storageScopeId, artifactId, bindingGeneration) {
      const result = await pool.query<{ revision: string | null; phase: string | null; applied: string | null;
        tombstone: string | null; session: string | null }>(`SELECT record->>'revision' AS revision,
        record->'runtime'->>'liveSessionId' AS session, record->'runtime'->>'phase' AS phase,
        record->'runtime'->>'appliedRevision' AS applied, record->>'tombstone' AS tombstone
        FROM artifacts.live_drafts WHERE storage_scope_id = $1 AND artifact_id = $2 AND binding_generation = $3`,
      [storageScopeId, artifactId, bindingGeneration]);
      const row = result.rows[0];
      if (!row?.revision) return undefined;
      return { revision: row.revision, liveSessionId: row.session ?? undefined,
        ready: row.tombstone === null && row.phase === "LIVE" && row.applied === row.revision };
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

/**
 * Grant request built from the §8.2 gate role and the SESSION invitation
 * state (identical for the owner and every invitee of the session).
 */
export function grantRequestFor(artifactId: string, role: LiveReaderRole, session: LiveSessionInvitationState): LiveGrantRequest {
  const base = { artifactId, bindingGeneration: role.bindingGeneration, principalId: role.principalId, session };
  if (role.role === "binding_owner") return base;
  return { ...base, invitation: { id: role.invitationId, expiresAt: Date.parse(role.expiresAt) } };
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
/** Baskets reader consent of the principal for this artifact (necessary, not sufficient), re-read on every admission. */
export type LiveConsentCheck = (principalId: string, artifactId: string) => Promise<boolean>;

export type LiveAdmission =
  /** Outside the §8.2 gate (or no valid live authorization record): refused, the release reader decides. */
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
  readonly sessionState: LiveSessionStatePort;
  readonly authorizations: LiveAuthorizationStore;
  readonly grants: Pick<LiveGrantClient, "grant" | "invalidate" | "invalidateInvitation">;
  readonly signAssertion: (claims: LiveAssertionClaims) => string;
  /** Proxied browser sockets, shared with the revocation below. */
  readonly sockets: LiveSocketRegistry;
  readonly revocation: ReturnType<typeof composeLiveEdgeRevocationWith>;
  /** Host-owned invitation operations (create, list, revoke), wired to the revocation. */
  readonly invitations: ReturnType<typeof createLiveInvitationService>;
  readonly now?: () => number;
}

type AdmissionPorts = Pick<LiveEdgePorts, "storageScopeId" | "gate" | "consent" | "readiness" | "sessionState" | "authorizations" |
  "grants">;

type Granted =
  | { readonly kind: "refused" }
  | { readonly kind: "release"; readonly reason: string }
  | { readonly kind: "granted"; readonly grant: LiveGrant; readonly role: LiveReaderRole };

/** Gate (a, b, c), readiness, session state and controller grant; the live authorization record (d) is the caller's. */
async function grantedRoute(ports: AdmissionPorts, artifactId: string, principalId: string): Promise<Granted> {
  // (b) current human with code rights and (c) binding owner or explicit live invitation.
  const role = await ports.gate(ports.storageScopeId, artifactId, principalId);
  if (!role || role.principalId !== principalId) return { kind: "refused" };
  // (a) baskets reader consent not revoked.
  if (!await ports.consent(principalId, artifactId)) return { kind: "refused" };
  const readiness = await ports.readiness.current(ports.storageScopeId, artifactId, role.bindingGeneration);
  if (!readiness?.ready || !readiness.liveSessionId) return { kind: "release", reason: "not_ready" };
  const session = await ports.sessionState.current(ports.storageScopeId, artifactId, role.bindingGeneration, readiness.liveSessionId);
  let outcome: LiveGrantOutcome;
  try { outcome = await ports.grants.grant(grantRequestFor(artifactId, role, session)); } catch { outcome = { kind: "unavailable" }; }
  if (outcome.kind !== "granted") {
    return { kind: "release", reason: outcome.kind === "conflict" ? `grant_${outcome.error}` : `grant_${outcome.kind}` };
  }
  const { grant } = outcome;
  // The grant names the live session of the package record (and, for an invitee, the session of the invitation).
  if (grant.sourceRevision !== readiness.revision || grant.storageScopeId !== ports.storageScopeId ||
    grant.generation !== role.bindingGeneration || grant.role !== role.role || grant.sessionId !== readiness.liveSessionId ||
    (role.role === "invitee" && grant.sessionId !== role.liveSessionId)) {
    ports.grants.invalidate(artifactId, principalId);
    return { kind: "release", reason: "grant_mismatch" };
  }
  return { kind: "granted", grant, role };
}

const authorizationKey = (storageScopeId: string, grant: LiveGrant) => ({ storageScopeId, artifactId: grant.artifactId,
  sessionId: grant.sessionId, bindingGeneration: grant.generation, principalId: grant.principalId, invitationId: grant.invitationId });

/**
 * §8.2 admission. The gate requires all four: (a) baskets reader consent not
 * revoked, (b) a current human with code rights, (c) binding owner or an
 * explicit live invitation, (d) a valid live authorization record for the
 * grant's session and generation (created for the owner on the first
 * admitted open; for an invitee only by explicit acceptance). Then live only
 * when the record is ready for the current revision and the grant answers
 * 200 with that sourceRevision; otherwise the release. Throws only on a
 * store failure (the caller keeps the release, or « live indisponible »).
 */
export async function admitLive(ports: AdmissionPorts, input: { readonly host: string; readonly artifactId: string;
  readonly principalId: string; readonly kid: string; readonly nowMs: number; readonly lifetimeSeconds: number }): Promise<LiveAdmission> {
  const route = await grantedRoute(ports, input.artifactId, input.principalId);
  if (route.kind === "refused") return { kind: "none" };
  if (route.kind === "release") return route;
  const { grant, role } = route;
  const key = authorizationKey(ports.storageScopeId, grant);
  let record = await ports.authorizations.find(key);
  if (!record && role.role === "binding_owner") {
    record = await ports.authorizations.ensure({ ...key, role: "binding_owner", expiresAt: null,
      createdAt: new Date(input.nowMs).toISOString() });
  }
  if (!isLiveAuthorizationValid(record, input.nowMs) || record.role !== role.role) return { kind: "none" };
  const claims = liveAssertionFromGrant({ grant, kid: input.kid, host: input.host, nowMs: input.nowMs,
    lifetimeSeconds: input.lifetimeSeconds });
  return claims ? { kind: "live", claims, grant } : { kind: "release", reason: "invitation_expired" };
}

/**
 * Explicit acceptance of a live invitation by its invitee (control origin,
 * application session): the invitee passes (a, b, c), the session is live
 * and the controller grants it; the live authorization record of the
 * invitation, principal, session and generation is then created.
 */
export async function acceptLiveInvitation(ports: AdmissionPorts, input: { readonly artifactId: string;
  readonly principalId: string; readonly invitationId: string; readonly nowMs: number }) {
  const route = await grantedRoute(ports, input.artifactId, input.principalId);
  if (route.kind === "refused" || (route.kind === "granted" && (route.role.role !== "invitee" ||
    route.role.invitationId !== input.invitationId))) throw new ArtifactOperationError("access_denied");
  if (route.kind === "release") throw new ArtifactOperationError("git_live_conflict", { publicDetails: { reason: "invalid_phase", live: route.reason } });
  const role = route.role as Extract<LiveReaderRole, { role: "invitee" }>;
  const record = await ports.authorizations.ensure({ ...authorizationKey(ports.storageScopeId, route.grant), role: "invitee",
    expiresAt: role.expiresAt, createdAt: new Date(input.nowMs).toISOString() });
  if (!isLiveAuthorizationValid(record, input.nowMs)) throw new ArtifactOperationError("access_denied");
  return record;
}

/** Composes the gate, readiness, grant client, signer, records, invitations and revocation; undefined while the switches are off. */
export function composeLiveEdgePorts(input: {
  readonly pool: pg.Pool; readonly storageScopeId: string; readonly env: NodeJS.ProcessEnv; readonly stage: GitModeStage;
  readonly contentBase: string; readonly module: LiveHostModule | undefined;
  /** Baskets reader consent; absent refuses every principal (fail-closed). */
  readonly consent?: LiveConsentCheck | undefined;
  readonly fetch?: typeof fetch;
  readonly send?: LiveControlTransport;
  /** Revocation push failures (the local effects already happened). */
  readonly onPushFailure?: (error: unknown) => void;
}): LiveEdgePorts | undefined {
  const resolution = readLiveEdgeForward(input.env, input.stage, input.contentBase);
  if (!resolution.enabled) return undefined;
  const gitConfig = readGitModeConfig(input.env);
  const invitationsQualified = () => gitConfig.liveInvitationsQualified === true;
  const { bindings, registry, codeRights } = composeGitAccess({ pool: input.pool, storageScopeId: input.storageScopeId,
    config: gitConfig });
  const invitationStore = createPostgresLiveInvitationStore(input.pool);
  const sessions = createPostgresLiveSessions(input.pool);
  const gate = createLiveReaderGate({ bindings, registry, codeRights, invitations: invitationStore, sessions, invitationsQualified });
  const grants = createLiveGrantClient({ baseUrl: gitConfig.builderUrl,
    identity: serviceTokenSource(gitConfig.service ?? {}, SERVICE_SCOPE_BUILDER, input.fetch),
    ...(input.fetch ? { fetch: input.fetch } : {}) });
  const signer = liveSignerFrom(input.module, resolution.config?.key);
  const sockets = createLiveSocketRegistry();
  const authorizations = createPostgresLiveAuthorizationStore(input.pool);
  let edge;
  try { edge = readLiveEdgeConfig(input.env); } catch { edge = {}; }
  const revocation = composeLiveEdgeRevocationWith(resolution.config ? edge : {}, sockets, signer, input.send,
    { grants, authorizations, storageScopeId: input.storageScopeId });
  const invitations = createLiveInvitationService({ bindings, registry, codeRights, invitations: invitationStore, sessions,
    invitationsQualified,
    // Sockets closed, grants dropped, records revoked, then the push (new session epoch); a push failure is reported, not fatal.
    onRevoked: (invitation) => revocation.invitation(invitation).catch((error: unknown) => { input.onPushFailure?.(error); }) });
  return { storageScopeId: input.storageScopeId, resolution, gate, consent: input.consent ?? (async () => false),
    readiness: createPostgresLiveReadiness(input.pool),
    sessionState: createLiveSessionStatePort(invitationStore, invitationsQualified), authorizations, grants,
    signAssertion: (claims) => signer.signAssertion(claims), sockets, revocation, invitations };
}
