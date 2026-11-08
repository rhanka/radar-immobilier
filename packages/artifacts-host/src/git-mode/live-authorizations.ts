import { randomUUID } from "node:crypto";

/**
 * Session-bound live authorization records (A-LIVE §8.2, s-archi 2026-11-07),
 * table `artifacts.live_authorizations` (immo migration 0041).
 *
 * The baskets reader consent is necessary but not sufficient for live: the
 * content-host gate also requires a live authorization record of the
 * principal for the controller session and generation named by the grant.
 * - binding owner: created on the first admitted live open;
 * - invitee: one row per (invitationId, principal, sessionId, generation),
 *   created only on the invitee's explicit acceptance.
 * A record is void when the grant names another session or generation (it is
 * looked up by both), on stop (new session), on revocation (revokedAt) and,
 * for an invitee, at the invitation expiry. It grants no data right.
 */
export interface LiveAuthorization {
  readonly authorizationId: string;
  readonly storageScopeId: string;
  readonly artifactId: string;
  /** Controller session id (grant.sessionId). */
  readonly sessionId: string;
  /** Binding generation (grant.generation). */
  readonly bindingGeneration: number;
  readonly principalId: string;
  readonly role: "binding_owner" | "invitee";
  /** '' for the binding owner. */
  readonly invitationId: string;
  readonly createdAt: string;
  /** Invitee: the invitation expiry; owner: null. */
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export type LiveAuthorizationKey = Pick<LiveAuthorization, "storageScopeId" | "artifactId" | "sessionId" | "bindingGeneration" |
  "principalId" | "invitationId">;

export interface LiveAuthorizationStore {
  find(key: LiveAuthorizationKey): Promise<LiveAuthorization | undefined>;
  /** Put-if-absent on the key; returns the stored row (possibly an earlier, revoked one). */
  ensure(record: Omit<LiveAuthorization, "authorizationId" | "createdAt" | "revokedAt"> & { readonly createdAt?: string }): Promise<LiveAuthorization>;
  revokeSession(storageScopeId: string, artifactId: string, sessionId: string, at: string): Promise<number>;
  revokeInvitation(storageScopeId: string, artifactId: string, invitationId: string, at: string): Promise<number>;
  /** Non-revoked session ids of an artifact (owner "stop sharing now"). */
  openSessions(storageScopeId: string, artifactId: string): Promise<string[]>;
}

/** Valid = not revoked and, for an invitee, not expired (the key binds session and generation). */
export function isLiveAuthorizationValid(record: LiveAuthorization | undefined, nowMs: number): record is LiveAuthorization {
  return !!record && record.revokedAt === null && (record.expiresAt === null || Date.parse(record.expiresAt) > nowMs);
}

const keyOf = (key: LiveAuthorizationKey) => JSON.stringify([key.storageScopeId, key.artifactId, key.sessionId,
  key.bindingGeneration, key.principalId, key.invitationId]);

export function createMemoryLiveAuthorizationStore(now: () => number = Date.now): LiveAuthorizationStore & {
  rows: Map<string, LiveAuthorization>;
} {
  const rows = new Map<string, LiveAuthorization>();
  const revokeWhere = (match: (row: LiveAuthorization) => boolean, at: string) => {
    let count = 0;
    for (const [key, row] of rows) if (row.revokedAt === null && match(row)) { rows.set(key, { ...row, revokedAt: at }); count += 1; }
    return count;
  };
  return {
    rows,
    async find(key) { const row = rows.get(keyOf(key)); return row ? structuredClone(row) : undefined; },
    async ensure(record) {
      const key = keyOf(record);
      const existing = rows.get(key);
      if (existing) return structuredClone(existing);
      const row: LiveAuthorization = { ...record, authorizationId: randomUUID(),
        createdAt: record.createdAt ?? new Date(now()).toISOString(), revokedAt: null };
      rows.set(key, row);
      return structuredClone(row);
    },
    async revokeSession(scope, artifactId, sessionId, at) {
      return revokeWhere((row) => row.storageScopeId === scope && row.artifactId === artifactId && row.sessionId === sessionId, at);
    },
    async revokeInvitation(scope, artifactId, invitationId, at) {
      return revokeWhere((row) => row.storageScopeId === scope && row.artifactId === artifactId && row.invitationId === invitationId &&
        invitationId !== "", at);
    },
    async openSessions(scope, artifactId) {
      return [...new Set([...rows.values()].filter((row) => row.storageScopeId === scope && row.artifactId === artifactId &&
        row.revokedAt === null).map((row) => row.sessionId))];
    },
  };
}

interface Queryable { query<R extends object>(text: string, values: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }> }
interface AuthorizationRow {
  authorization_id: string; storage_scope_id: string; artifact_id: string; session_id: string; binding_generation: string | number;
  principal_id: string; role: "binding_owner" | "invitee"; invitation_id: string; created_at: Date; expires_at: Date | null;
  revoked_at: Date | null;
}
const fromRow = (row: AuthorizationRow): LiveAuthorization => ({ authorizationId: row.authorization_id,
  storageScopeId: row.storage_scope_id, artifactId: row.artifact_id, sessionId: row.session_id,
  bindingGeneration: Number(row.binding_generation), principalId: row.principal_id, role: row.role, invitationId: row.invitation_id,
  createdAt: row.created_at.toISOString(), expiresAt: row.expires_at?.toISOString() ?? null,
  revokedAt: row.revoked_at?.toISOString() ?? null });

const FIND = `SELECT * FROM artifacts.live_authorizations WHERE storage_scope_id = $1 AND artifact_id = $2 AND session_id = $3
  AND binding_generation = $4 AND principal_id = $5 AND invitation_id = $6`;

/** Durable store over artifacts.live_authorizations (immo migration 0041). */
export function createPostgresLiveAuthorizationStore(pool: Queryable): LiveAuthorizationStore {
  return {
    async find(key) {
      const result = await pool.query<AuthorizationRow>(FIND, [key.storageScopeId, key.artifactId, key.sessionId,
        key.bindingGeneration, key.principalId, key.invitationId]);
      return result.rows[0] ? fromRow(result.rows[0]) : undefined;
    },
    async ensure(record) {
      await pool.query(`INSERT INTO artifacts.live_authorizations (authorization_id, storage_scope_id, artifact_id, session_id,
        binding_generation, principal_id, role, invitation_id, created_at, expires_at, revoked_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL) ON CONFLICT DO NOTHING`, [randomUUID(), record.storageScopeId, record.artifactId,
        record.sessionId, record.bindingGeneration, record.principalId, record.role, record.invitationId,
        record.createdAt ?? new Date().toISOString(), record.expiresAt]);
      const result = await pool.query<AuthorizationRow>(FIND, [record.storageScopeId, record.artifactId, record.sessionId,
        record.bindingGeneration, record.principalId, record.invitationId]);
      return fromRow(result.rows[0]!);
    },
    async revokeSession(scope, artifactId, sessionId, at) {
      const result = await pool.query(`UPDATE artifacts.live_authorizations SET revoked_at = $4::timestamptz
        WHERE storage_scope_id = $1 AND artifact_id = $2 AND session_id = $3 AND revoked_at IS NULL`, [scope, artifactId, sessionId, at]);
      return result.rowCount ?? 0;
    },
    async revokeInvitation(scope, artifactId, invitationId, at) {
      if (!invitationId) return 0;
      const result = await pool.query(`UPDATE artifacts.live_authorizations SET revoked_at = $4::timestamptz
        WHERE storage_scope_id = $1 AND artifact_id = $2 AND invitation_id = $3 AND revoked_at IS NULL`,
      [scope, artifactId, invitationId, at]);
      return result.rowCount ?? 0;
    },
    async openSessions(scope, artifactId) {
      const result = await pool.query<{ session_id: string }>(`SELECT DISTINCT session_id FROM artifacts.live_authorizations
        WHERE storage_scope_id = $1 AND artifact_id = $2 AND revoked_at IS NULL ORDER BY session_id`, [scope, artifactId]);
      return result.rows.map((row) => row.session_id);
    },
  };
}
