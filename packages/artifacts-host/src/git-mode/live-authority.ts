import { randomUUID } from "node:crypto";
import type { GitBinding, GitBindingStore, GitCodeRightsPort, GitHumanDirectory, GitRepositoryRegistry, LiveAuthority, LiveInvocation } from "@sentropic/artifacts";
import { ArtifactOperationError } from "@sentropic/artifacts/server/outcome-contract";
import { GIT_HOST_WRITE_SCOPE } from "./identity.js";
import { IMMO_GIT_OUTPUT_DIR } from "./registry.js";

/**
 * Live authority, invitations and the content-host reader gate (M4-I, Δ4).
 *
 * - Each user edits THEIR OWN personal binding: the binding owner is the
 *   acting user (`personalPrincipalId`), never a platform owner. Writes need
 *   current code rights, the host write scope and a GitHub linkage.
 * - Invited live readers: an explicit invitation by the binding owner,
 *   bound to the binding, its live session and its generation, with an
 *   expiry and a revocation epoch. The invitee must hold current code rights.
 *   Invitees read (live_read, live_status) and never edit or publish.
 * - Anyone else, including other code-rights holders without an invitation,
 *   is refused (`access_denied`); a different principal never writes to
 *   someone else's binding (co-editing would be a contract change).
 *
 * Revocation and expiry are evaluated on every call: there is no cached
 * authority, so a revoked invitee is refused on the next call.
 *
 * Invitation epoch (W9, s-archi 2026-11-07): SESSION state of the binding
 * generation, shared by every active invitation of the session. 0 until the
 * first invitation; +1 on each revoke or replace, and every remaining
 * invitation adopts the new value; never lowered. Several invitations may be
 * active at once, each naming exactly one principal. The invited-reader path
 * is admitted only with IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED=true
 * (default off; turned on by an ops change after an owner-recorded
 * « GB4 GO preprod »).
 */

export interface LiveInvitation {
  readonly invitationId: string;
  readonly storageScopeId: string;
  readonly artifactId: string;
  readonly bindingGeneration: number;
  readonly liveSessionId: string;
  readonly inviteeId: string;
  readonly grantorId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  /** The session epoch this row carries (equal to the session epoch while the row is active). */
  readonly epoch: number;
}

/** Session invitation state sent to the controller (grant and reconcile bodies). */
export interface LiveSessionInvitationState { readonly epoch: number; readonly expiresAt: number | null }

/**
 * Session epoch = highest epoch of the generation's rows (0 without any);
 * expiresAt = latest expiry among the ACTIVE invitations of the live session,
 * null when none (or when invitations are not qualified).
 */
export function sessionInvitationState(rows: readonly LiveInvitation[], session: { readonly bindingGeneration: number;
  readonly liveSessionId: string | undefined }, now: number, invitationsQualified = true): LiveSessionInvitationState {
  const generation = rows.filter((row) => row.bindingGeneration === session.bindingGeneration);
  const epoch = generation.reduce((max, row) => Math.max(max, row.epoch), 0);
  const active = invitationsQualified ? generation.filter((row) => row.revokedAt === null && Date.parse(row.expiresAt) > now &&
    session.liveSessionId !== undefined && row.liveSessionId === session.liveSessionId && row.epoch === epoch) : [];
  const expiresAt = active.reduce<number | null>((max, row) => Math.max(max ?? 0, Date.parse(row.expiresAt)), null);
  return { epoch, expiresAt };
}

/** Session invitation state of a binding generation's live session (grant and reconcile bodies). */
export interface LiveSessionStatePort {
  current(storageScopeId: string, artifactId: string, bindingGeneration: number, liveSessionId: string): Promise<LiveSessionInvitationState>;
}

export function createLiveSessionStatePort(invitations: Pick<LiveInvitationStore, "list">, invitationsQualified: () => boolean,
  now: () => number = Date.now): LiveSessionStatePort {
  return {
    async current(storageScopeId, artifactId, bindingGeneration, liveSessionId) {
      return sessionInvitationState(await invitations.list(storageScopeId, artifactId), { bindingGeneration, liveSessionId }, now(),
        invitationsQualified());
    },
  };
}

export interface LiveInvitationStore {
  /** Inserts a row carrying the current session epoch (1 for the first invitation of the generation). */
  insert(invitation: Omit<LiveInvitation, "epoch">): Promise<LiveInvitation>;
  list(storageScopeId: string, artifactId: string): Promise<LiveInvitation[]>;
  /**
   * Sets revokedAt and raises the SESSION epoch by one: every row of the
   * generation adopts it. Undefined when unknown. Idempotent on an already
   * revoked row (no second bump).
   */
  revoke(storageScopeId: string, artifactId: string, invitationId: string, at: string): Promise<LiveInvitation | undefined>;
}

/**
 * Current live session of a binding generation; undefined while dormant or
 * stopped. `expiresAt` is the session end when the controller announces one
 * (A-LIVE v2 Amendment 1: no maximum lifetime, idle stop owned by the
 * controller, so usually absent); an invitation never outlives it.
 */
export interface LiveSessionPort {
  current(binding: GitBinding): Promise<{ liveSessionId: string; expiresAt?: string } | undefined>;
}

export function isInvitationActive(invitation: LiveInvitation, binding: GitBinding, liveSessionId: string | undefined, now: number) {
  return invitation.revokedAt === null && Date.parse(invitation.expiresAt) > now && invitation.epoch >= 1 &&
    invitation.storageScopeId === binding.storageScopeId && invitation.artifactId === binding.artifactId &&
    invitation.bindingGeneration === binding.generation && liveSessionId !== undefined && invitation.liveSessionId === liveSessionId;
}

export interface LiveAuthorityDeps {
  readonly bindings: GitBindingStore;
  readonly registry: GitRepositoryRegistry;
  readonly codeRights: GitCodeRightsPort;
  readonly directory: GitHumanDirectory;
  readonly invitations: LiveInvitationStore;
  readonly sessions: LiveSessionPort;
  readonly hasWriteScope: () => boolean;
  /** Worker qualification (GB4 / M4-lite). False until qualified: live_write answers builder_unavailable. */
  readonly qualified: () => boolean;
  /** Invited-reader path (IMMO_ARTIFACTS_LIVE_INVITATIONS_QUALIFIED). Absent or false: every invitee is refused. */
  readonly invitationsQualified?: () => boolean;
  readonly now?: () => number;
}

const denied = (): never => { throw new ArtifactOperationError("access_denied"); };

async function bindingContext(deps: Pick<LiveAuthorityDeps, "bindings" | "registry">, storageScopeId: string, artifactId: string) {
  const binding = await deps.bindings.get(storageScopeId, artifactId);
  if (!binding || binding.state === "detached") throw new ArtifactOperationError("git_not_attached");
  if (binding.channel !== "personal" || !binding.personalPrincipalId) return denied();
  const repository = await deps.registry.get(binding.storageScopeId, binding.repoId);
  if (!repository) throw new ArtifactOperationError("git_repo_not_registered");
  return { binding, repository, ownerId: binding.personalPrincipalId };
}

/** The principal's active invitation of the current session, carrying the current session epoch. */
async function activeInvitation(deps: Pick<LiveAuthorityDeps, "invitations" | "sessions" | "invitationsQualified">,
  binding: GitBinding, principalId: string, now: number) {
  if (!(deps.invitationsQualified?.() ?? false)) return undefined;
  const session = await deps.sessions.current(binding);
  const rows = await deps.invitations.list(binding.storageScopeId, binding.artifactId);
  const { epoch } = sessionInvitationState(rows, { bindingGeneration: binding.generation, liveSessionId: session?.liveSessionId }, now);
  return rows.find((row) => row.inviteeId === principalId && row.epoch === epoch &&
    isInvitationActive(row, binding, session?.liveSessionId, now));
}

export function createLiveAuthorize(deps: LiveAuthorityDeps) {
  const now = deps.now ?? Date.now;
  return async (invocation: LiveInvocation, artifactId: string): Promise<LiveAuthority> => {
    const { binding, repository, ownerId } = await bindingContext(deps, invocation.storageScopeId, artifactId);
    const canReadCode = await deps.codeRights.canReadCode({ storageScopeId: binding.storageScopeId,
      repoId: binding.repoId, actorId: invocation.actorId });
    const target = { storageScopeId: binding.storageScopeId, repoId: binding.repoId, branch: binding.branch,
      subPath: binding.subPath, principalId: invocation.actorId, outputDir: IMMO_GIT_OUTPUT_DIR };
    const portRepository = { storageScopeId: repository.storageScopeId, repoId: repository.repoId, locator: repository.locator,
      installationRef: repository.installationRef, branchPrefix: repository.branchPrefix, allowedSubPaths: repository.allowedSubPaths,
      canWrite: repository.canWrite, writablePaths: repository.writablePaths, refusedWritePaths: repository.refusedWritePaths };
    if (invocation.actorId === ownerId) {
      return { binding, ownerId, canReadCode, repository: portRepository, target, invited: false,
        canWrite: canReadCode && repository.canWrite && deps.hasWriteScope(),
        humanLinked: await deps.directory.resolve({ storageScopeId: binding.storageScopeId, principalId: invocation.actorId }) !== null,
        qualified: deps.qualified() };
    }
    // Not the binding owner: only an active invitee with current code rights, read-only.
    if (!canReadCode || !await activeInvitation(deps, binding, invocation.actorId, now())) return denied();
    return { binding, ownerId, canReadCode: true, canWrite: false, humanLinked: false, invited: true,
      qualified: deps.qualified(), repository: portRepository, target };
  };
}

export type LiveReaderRole =
  | { readonly role: "binding_owner"; readonly principalId: string; readonly bindingGeneration: number }
  | { readonly role: "invitee"; readonly principalId: string; readonly bindingGeneration: number;
    readonly invitationId: string; readonly epoch: number; readonly expiresAt: string; readonly liveSessionId: string };

/**
 * Content-host live reader gate (A-LIVE §8.2): the binding owner or an active
 * invitee, both with current code rights. Null refuses. The live edge host
 * assertion (W9) carries the returned role, invitation id, epoch and expiry.
 */
export function createLiveReaderGate(deps: Pick<LiveAuthorityDeps, "bindings" | "registry" | "codeRights" | "invitations" | "sessions" | "now" | "invitationsQualified">) {
  const now = deps.now ?? Date.now;
  return async (storageScopeId: string, artifactId: string, principalId: string): Promise<LiveReaderRole | null> => {
    let context;
    try { context = await bindingContext(deps, storageScopeId, artifactId); } catch { return null; }
    const { binding, ownerId } = context;
    if (!await deps.codeRights.canReadCode({ storageScopeId, repoId: binding.repoId, actorId: principalId })) return null;
    if (principalId === ownerId) return { role: "binding_owner", principalId, bindingGeneration: binding.generation };
    const invitation = await activeInvitation(deps, binding, principalId, now());
    return invitation ? { role: "invitee", principalId, bindingGeneration: binding.generation, invitationId: invitation.invitationId,
      epoch: invitation.epoch, expiresAt: invitation.expiresAt, liveSessionId: invitation.liveSessionId } : null;
  };
}

/**
 * Invitation ceilings: one hour by default, eight hours at most, capped at
 * the announced session end, and void as soon as the session id or the
 * binding generation changes (isInvitationActive).
 */
export const LIVE_INVITATION_DEFAULT_TTL_MS = 60 * 60 * 1000;
export const LIVE_INVITATION_MAX_TTL_MS = 8 * 60 * 60 * 1000;
export const LIVE_INVITATION_READ_SCOPE = "immo:artifacts:read" as const;
export const LIVE_INVITATION_WRITE_SCOPE = GIT_HOST_WRITE_SCOPE;

export interface InvitationCaller { readonly actorId: string; readonly storageScopeId: string; readonly scopes: readonly string[] }

/**
 * Host-owned invitation operations (create, list, revoke), scoped by binding,
 * live session and generation. They use the immo artifact scopes and do not
 * widen the artifacts access enum (set_access stays read grants only).
 */
export function createLiveInvitationService(deps: Pick<LiveAuthorityDeps, "bindings" | "registry" | "codeRights" | "invitations" | "sessions" | "now" | "invitationsQualified"> & {
  /** Live edge revocation (live-edge.ts): close the invitee's sockets, then push the fence. Errors are surfaced. */
  readonly onRevoked?: (invitation: LiveInvitation) => Promise<unknown>;
}) {
  const qualified = () => {
    if (!(deps.invitationsQualified?.() ?? false)) {
      throw new ArtifactOperationError("provider_unavailable", { publicDetails: { invitations: "unqualified" } });
    }
  };
  const now = deps.now ?? Date.now;
  const ownBinding = async (caller: InvitationCaller, artifactId: string, scope: string) => {
    if (!caller.scopes.includes(scope)) denied();
    const context = await bindingContext(deps, caller.storageScopeId, artifactId);
    if (context.ownerId !== caller.actorId) denied();
    return context;
  };
  return {
    async create(caller: InvitationCaller, input: { artifactId: string; inviteeId: string; ttlMs?: number }) {
      qualified();
      const { binding } = await ownBinding(caller, input.artifactId, LIVE_INVITATION_WRITE_SCOPE);
      const ttl = input.ttlMs ?? LIVE_INVITATION_DEFAULT_TTL_MS;
      if (!input.inviteeId.trim() || input.inviteeId === caller.actorId || !Number.isSafeInteger(ttl) || ttl < 1 ||
        ttl > LIVE_INVITATION_MAX_TTL_MS) throw new ArtifactOperationError("invalid_request");
      const session = await deps.sessions.current(binding);
      if (!session) throw new ArtifactOperationError("git_not_attached");
      if (!await deps.codeRights.canReadCode({ storageScopeId: binding.storageScopeId, repoId: binding.repoId,
        actorId: input.inviteeId })) denied();
      const at = now();
      const sessionEnd = session.expiresAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(session.expiresAt);
      if (!(sessionEnd > at)) throw new ArtifactOperationError("git_not_attached");
      const expiresAt = Math.min(at + ttl, sessionEnd);
      // Replace: the invitee's previous unrevoked invitation of this generation is revoked first (session epoch +1).
      const previous = (await deps.invitations.list(binding.storageScopeId, binding.artifactId))
        .filter((row) => row.inviteeId === input.inviteeId && row.bindingGeneration === binding.generation && row.revokedAt === null);
      for (const row of previous) {
        const revoked = await deps.invitations.revoke(binding.storageScopeId, binding.artifactId, row.invitationId,
          new Date(at).toISOString());
        if (revoked) await deps.onRevoked?.(revoked);
      }
      return deps.invitations.insert({ invitationId: randomUUID(), storageScopeId: binding.storageScopeId,
        artifactId: binding.artifactId, bindingGeneration: binding.generation, liveSessionId: session.liveSessionId,
        inviteeId: input.inviteeId, grantorId: caller.actorId, createdAt: new Date(at).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(), revokedAt: null });
    },
    async list(caller: InvitationCaller, input: { artifactId: string }) {
      const { binding } = await ownBinding(caller, input.artifactId, LIVE_INVITATION_READ_SCOPE);
      const session = await deps.sessions.current(binding);
      const rows = await deps.invitations.list(binding.storageScopeId, binding.artifactId);
      const state = sessionInvitationState(rows, { bindingGeneration: binding.generation, liveSessionId: session?.liveSessionId }, now(),
        deps.invitationsQualified?.() ?? false);
      return rows.map((row) => ({ ...row, active: (deps.invitationsQualified?.() ?? false) && row.epoch === state.epoch &&
        isInvitationActive(row, binding, session?.liveSessionId, now()) }));
    },
    async revoke(caller: InvitationCaller, input: { artifactId: string; invitationId: string }) {
      // Revocation stays possible while invitations are unqualified (it only narrows access).
      const { binding } = await ownBinding(caller, input.artifactId, LIVE_INVITATION_WRITE_SCOPE);
      const revoked = await deps.invitations.revoke(binding.storageScopeId, binding.artifactId, input.invitationId,
        new Date(now()).toISOString());
      if (!revoked) throw new ArtifactOperationError("not_found");
      // The durable revocation already refuses the invitee on its next call; the edge is tightened next.
      await deps.onRevoked?.(revoked);
      return revoked;
    },
  };
}

export function createMemoryLiveInvitationStore(): LiveInvitationStore {
  const rows = new Map<string, LiveInvitation>();
  const sessionRows = (scope: string, artifactId: string, generation: number) => [...rows.values()]
    .filter((row) => row.storageScopeId === scope && row.artifactId === artifactId && row.bindingGeneration === generation);
  const sessionEpoch = (scope: string, artifactId: string, generation: number) =>
    sessionRows(scope, artifactId, generation).reduce((max, row) => Math.max(max, row.epoch), 0);
  return {
    async insert(input) {
      if (rows.has(input.invitationId)) throw new ArtifactOperationError("invalid_request");
      const epoch = Math.max(1, sessionEpoch(input.storageScopeId, input.artifactId, input.bindingGeneration));
      const invitation: LiveInvitation = { ...structuredClone(input), epoch };
      rows.set(invitation.invitationId, invitation);
      return structuredClone(invitation);
    },
    async list(storageScopeId, artifactId) {
      return [...rows.values()].filter((row) => row.storageScopeId === storageScopeId && row.artifactId === artifactId)
        .map((row) => structuredClone(row));
    },
    async revoke(storageScopeId, artifactId, invitationId, at) {
      const row = rows.get(invitationId);
      if (!row || row.storageScopeId !== storageScopeId || row.artifactId !== artifactId) return undefined;
      if (row.revokedAt !== null) return structuredClone(row);
      const epoch = sessionEpoch(storageScopeId, artifactId, row.bindingGeneration) + 1;
      for (const other of sessionRows(storageScopeId, artifactId, row.bindingGeneration)) rows.set(other.invitationId, { ...other, epoch });
      const next = { ...row, revokedAt: at, epoch };
      rows.set(invitationId, next);
      return structuredClone(next);
    },
  };
}

interface Queryable { query<R extends object>(text: string, values: unknown[]): Promise<{ rows: R[] }> }
interface Transactional extends Queryable { connect(): Promise<Queryable & { release(): void }> }
interface InvitationRow {
  invitation_id: string; storage_scope_id: string; artifact_id: string; binding_generation: string | number;
  live_session_id: string; invitee_id: string; grantor_id: string; created_at: Date; expires_at: Date;
  revoked_at: Date | null; epoch: string | number;
}
const fromRow = (row: InvitationRow): LiveInvitation => ({ invitationId: row.invitation_id, storageScopeId: row.storage_scope_id,
  artifactId: row.artifact_id, bindingGeneration: Number(row.binding_generation), liveSessionId: row.live_session_id,
  inviteeId: row.invitee_id, grantorId: row.grantor_id, createdAt: row.created_at.toISOString(),
  expiresAt: row.expires_at.toISOString(), revokedAt: row.revoked_at?.toISOString() ?? null, epoch: Number(row.epoch) });

/**
 * Serializes the session-epoch writers of one binding generation (insert and
 * revoke) in a transaction under an advisory lock.
 */
async function inSession<T>(pool: Transactional, key: readonly [string, string, number], action: (tx: Queryable) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN", []);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 38))", [JSON.stringify(key)]);
    const result = await action(client);
    await client.query("COMMIT", []);
    return result;
  } catch (error) {
    await client.query("ROLLBACK", []).catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

const SESSION_EPOCH = `SELECT COALESCE(MAX(epoch), 0)::int AS epoch FROM artifacts.live_invitations
  WHERE storage_scope_id = $1 AND artifact_id = $2 AND binding_generation = $3`;

/** Durable store over artifacts.live_invitations (immo migration 0038), session epoch per binding generation. */
export function createPostgresLiveInvitationStore(pool: Transactional): LiveInvitationStore {
  return {
    async insert(invitation) {
      return inSession(pool, [invitation.storageScopeId, invitation.artifactId, invitation.bindingGeneration], async (tx) => {
        const current = (await tx.query<{ epoch: number }>(SESSION_EPOCH, [invitation.storageScopeId, invitation.artifactId,
          invitation.bindingGeneration])).rows[0]?.epoch ?? 0;
        const result = await tx.query<InvitationRow>(`INSERT INTO artifacts.live_invitations (invitation_id, storage_scope_id,
          artifact_id, binding_generation, live_session_id, invitee_id, grantor_id, created_at, expires_at, revoked_at, epoch)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10) RETURNING *`, [invitation.invitationId, invitation.storageScopeId,
          invitation.artifactId, invitation.bindingGeneration, invitation.liveSessionId, invitation.inviteeId, invitation.grantorId,
          invitation.createdAt, invitation.expiresAt, Math.max(1, current)]);
        return fromRow(result.rows[0]!);
      });
    },
    async list(storageScopeId, artifactId) {
      const result = await pool.query<InvitationRow>(`SELECT * FROM artifacts.live_invitations
        WHERE storage_scope_id = $1 AND artifact_id = $2 ORDER BY created_at, invitation_id`, [storageScopeId, artifactId]);
      return result.rows.map(fromRow);
    },
    async revoke(storageScopeId, artifactId, invitationId, at) {
      const target = (await pool.query<InvitationRow>(`SELECT * FROM artifacts.live_invitations
        WHERE storage_scope_id = $1 AND artifact_id = $2 AND invitation_id = $3`, [storageScopeId, artifactId, invitationId])).rows[0];
      if (!target) return undefined;
      const generation = Number(target.binding_generation);
      return inSession(pool, [storageScopeId, artifactId, generation], async (tx) => {
        const row = (await tx.query<InvitationRow>(`SELECT * FROM artifacts.live_invitations
          WHERE storage_scope_id = $1 AND artifact_id = $2 AND invitation_id = $3`, [storageScopeId, artifactId, invitationId])).rows[0]!;
        if (row.revoked_at !== null) return fromRow(row);
        const current = (await tx.query<{ epoch: number }>(SESSION_EPOCH, [storageScopeId, artifactId, generation])).rows[0]?.epoch ?? 0;
        // Every row of the generation adopts the new session epoch; the revoked one also gets revoked_at.
        await tx.query(`UPDATE artifacts.live_invitations SET epoch = $4
          WHERE storage_scope_id = $1 AND artifact_id = $2 AND binding_generation = $3`, [storageScopeId, artifactId, generation, current + 1]);
        const result = await tx.query<InvitationRow>(`UPDATE artifacts.live_invitations SET revoked_at = $4::timestamptz
          WHERE storage_scope_id = $1 AND artifact_id = $2 AND invitation_id = $3 RETURNING *`, [storageScopeId, artifactId, invitationId, at]);
        return fromRow(result.rows[0]!);
      });
    },
  };
}

/** Live session of the current generation, read from the provider draft record (0037). */
export function createPostgresLiveSessions(pool: Queryable): LiveSessionPort {
  return {
    async current(binding) {
      const result = await pool.query<{ live_session_id: string | null; phase: string | null; ends_at: string | null }>(`SELECT
        record->'runtime'->>'liveSessionId' AS live_session_id, record->'runtime'->>'phase' AS phase,
        record->'runtime'->>'maximumLifetimeAt' AS ends_at
        FROM artifacts.live_drafts WHERE storage_scope_id = $1 AND artifact_id = $2 AND binding_generation = $3`,
      [binding.storageScopeId, binding.artifactId, binding.generation]);
      const row = result.rows[0];
      if (!row?.live_session_id || ["DORMANT", "DECOMMISSIONING", "FAILED"].includes(row.phase ?? "")) return undefined;
      return { liveSessionId: row.live_session_id, ...(row.ends_at ? { expiresAt: row.ends_at } : {}) };
    },
  };
}
