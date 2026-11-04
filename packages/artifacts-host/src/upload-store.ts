import type pg from "pg";
import type {
  StagedFileRecord,
  UploadSession,
  UploadSessionStore,
} from "@sentropic/artifacts/server/uploads";

/**
 * Files parity LOT 1 — Postgres upload session ledger (immo host port).
 *
 * Backs the generic UploadSessionStore over the immo `artifacts.uploads`
 * table (durable rows bound to artifact + storage scope + owner, with
 * `expires_at` for the enforced staging sweeper) and the
 * `artifacts.staged_files` records that `commit_upload` writes and
 * `publish_bundle` references. Tables come from the immo migration mirroring
 * the generic 0007; this module performs no DDL.
 */

interface UploadRow {
  id: string;
  artifact_id: string | null;
  storage_scope_id: string | null;
  owner_id: string | null;
  mime_type: string;
  max_size: number;
  state: string;
  expires_at: Date | null;
  created_at: Date;
}

interface StagedRow {
  upload_id: string;
  artifact_id: string;
  path: string;
  mime_type: string;
  digest: string;
  size: number;
  created_at: Date;
}

function toSession(row: UploadRow): UploadSession {
  if (row.artifact_id === null || row.storage_scope_id === null || row.owner_id === null ||
    row.expires_at === null) {
    throw new Error(`upload session missing binding: ${row.id}`);
  }
  const state = row.state;
  if (state !== "open" && state !== "committed" && state !== "discarded" && state !== "expired") {
    throw new Error(`upload session invalid state: ${row.id}`);
  }
  return {
    uploadId: row.id,
    artifactId: row.artifact_id,
    storageScopeId: row.storage_scope_id,
    ownerId: row.owner_id,
    mimeType: row.mime_type,
    maxSize: row.max_size,
    state,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function toStaged(row: StagedRow): StagedFileRecord {
  return {
    uploadId: row.upload_id,
    artifactId: row.artifact_id,
    path: row.path,
    mimeType: row.mime_type,
    digest: row.digest,
    size: row.size,
    createdAt: row.created_at.toISOString(),
  };
}

/** Postgres-backed UploadSessionStore over an injected pool (no DDL). */
export function createPostgresUploadSessionStore(pool: pg.Pool): UploadSessionStore {
  return {
    async create(session) {
      await pool.query(
        `INSERT INTO artifacts.uploads (id, artifact_id, storage_scope_id, owner_id,
           mime_type, max_size, size, state, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 'open', $7)`,
        [session.uploadId, session.artifactId, session.storageScopeId, session.ownerId,
          session.mimeType, session.maxSize, session.expiresAt]);
    },
    async get(uploadId) {
      const { rows } = await pool.query<UploadRow>(
        "SELECT * FROM artifacts.uploads WHERE id = $1", [uploadId]);
      if (rows[0] === undefined) return undefined;
      try {
        return toSession(rows[0]);
      } catch {
        // Legacy unbound rows (closed by the migration backfill) never
        // surface as committable sessions.
        return undefined;
      }
    },
    async countOpen(storageScopeId, ownerId) {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM artifacts.uploads
         WHERE storage_scope_id = $1 AND owner_id = $2 AND state = 'open'`,
        [storageScopeId, ownerId]);
      return Number(rows[0]?.count ?? 0);
    },
    async listExpiredOpen(now) {
      const { rows } = await pool.query<UploadRow>(
        `SELECT * FROM artifacts.uploads
         WHERE state = 'open' AND expires_at <= $1 ORDER BY expires_at, id`,
        [now.toISOString()]);
      const sessions: UploadSession[] = [];
      for (const row of rows) {
        try {
          sessions.push(toSession(row));
        } catch {
          // Skip unbound legacy rows; the backfill closes them separately.
        }
      }
      return sessions;
    },
    async markCommitted(uploadId) {
      const { rowCount } = await pool.query(
        "UPDATE artifacts.uploads SET state = 'committed' WHERE id = $1 AND state = 'open'",
        [uploadId]);
      if (rowCount !== 1) throw new Error(`unknown upload: ${uploadId}`);
    },
    async markExpired(uploadId) {
      const { rowCount } = await pool.query(
        "UPDATE artifacts.uploads SET state = 'expired' WHERE id = $1 AND state = 'open'",
        [uploadId]);
      if (rowCount !== 1) throw new Error(`unknown upload: ${uploadId}`);
    },
    async recordStagedFile(record) {
      await pool.query(
        `INSERT INTO artifacts.staged_files (upload_id, artifact_id, path, mime_type, digest, size)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [record.uploadId, record.artifactId, record.path, record.mimeType, record.digest, record.size]);
    },
    async getStagedFile(uploadId) {
      const { rows } = await pool.query<StagedRow>(
        "SELECT * FROM artifacts.staged_files WHERE upload_id = $1", [uploadId]);
      if (rows[0] === undefined) return undefined;
      return toStaged(rows[0]);
    },
    async listStagedFiles(artifactId) {
      const { rows } = await pool.query<StagedRow>(
        "SELECT * FROM artifacts.staged_files WHERE artifact_id = $1 ORDER BY path",
        [artifactId]);
      return rows.map(toStaged);
    },
  };
}
