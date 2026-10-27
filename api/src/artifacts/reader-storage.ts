import { createHash } from "node:crypto";
import type pg from "pg";
import type { PublicationBlobStore } from "@sentropic/artifacts/server/publication";
import { evaluateAccess } from "@sentropic/artifacts/server/access";
import type { AuthorityReader, ReaderProfile } from "./reader-profile.js";
import { normalizeReleasePath, type ReleaseFileProvider } from "./release-files.js";
import { createSharedReaderTickets, type SharedReaderTickets } from "./reader-tickets.js";

// The host grants only read capabilities; publisher profile fields cannot widen them.
export const BASKET_READER_PROFILE: ReaderProfile = {
  name: "radar-baskets", policyRevision: "basket-read-v1", capabilities: ["signals.protected-read"],
};

export function createStoredReader(pool: pg.Pool, scope: string, contentBase: string,
  blobs: Pick<PublicationBlobStore, "getBlob">): { authority: AuthorityReader; releaseFiles: ReleaseFileProvider;
    tickets: SharedReaderTickets; getArtifactIdForRelease: (releaseId: string) => Promise<string | null> } {
  const artifact = async (id: string, releaseId?: string) => (await pool.query(
    `SELECT a.*, a.xmin::text AS revision, r.id AS release_id,
       r.xmin::text AS release_revision, r.state AS release_state FROM artifacts.artifacts a
     JOIN artifacts.releases r ON r.artifact_id=a.id AND r.id=COALESCE($3::uuid,
       (SELECT release_id FROM artifacts.artifact_current WHERE artifact_id=a.id))
     WHERE a.id=$1 AND a.storage_scope_id=$2 AND a.lifecycle_state='active' AND r.state IN ('ready','retired')`,
    [id, scope, releaseId ?? null])).rows[0];
  const authority: AuthorityReader = {
    getContentOrigin: async (id) => await artifact(id) ? `https://${id}.${contentBase}` : null,
    getRelease: async (id, releaseId) => {
      const row = await artifact(id, releaseId);
      return row ? { artifactId: row.id, releaseId: row.release_id, authorSub: row.owner_id } : null;
    },
    getProfile: async (id) => await artifact(id) ? BASKET_READER_PROFILE : null,
    getRights: async (readerSub, id) => {
      const row = await artifact(id);
      if (!row) return null;
      const account = await pool.query("SELECT 1 FROM account_users WHERE sub=$1 AND status='approved'", [readerSub]);
      const acl = await pool.query("SELECT principal_id,permission FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2", [id, readerSub]);
      const allowed = evaluateAccess({ ownerId: row.owner_id, isPublic: row.is_public, withdrawn: false,
        grants: acl.rows.map((grant) => ({ principalId: grant.principal_id, grant: grant.permission })) }, readerSub, "read", () => account.rowCount === 1);
      const approved = account.rowCount === 1 && allowed;
      return { readerSub, artifactId: id, approved, capabilities: approved ? BASKET_READER_PROFILE.capabilities : [] };
    },
    getAuthorizationVersion: async (id, readerSub, releaseId) => {
      const row = await artifact(id, releaseId);
      if (!row) return null;
      // Row transaction identities fence delete/reinsert and restore-to-same-value races.
      const state = await pool.query(`SELECT
        (SELECT jsonb_agg(jsonb_build_array(principal_id, permission, xmin::text) ORDER BY principal_id)
         FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2) AS acl,
        (SELECT jsonb_build_array(sub, status, xmin::text) FROM account_users WHERE sub=$2) AS account`,
      [id, readerSub ?? null]);
      return createHash("sha256").update(JSON.stringify([row, state.rows[0], BASKET_READER_PROFILE])).digest("hex");
    },
  };
  return { authority, tickets: createSharedReaderTickets(pool),
    getArtifactIdForRelease: async (releaseId) => (await pool.query(`SELECT a.id FROM artifacts.artifacts a
      JOIN artifacts.releases r ON r.artifact_id=a.id WHERE r.id=$1 AND r.state IN ('ready','retired')
      AND a.storage_scope_id=$2 AND a.lifecycle_state='active'`, [releaseId, scope])).rows[0]?.id ?? null,
    releaseFiles: {
    getFile: async (artifactId, releaseId, path) => {
      const normalized = normalizeReleasePath(path);
      if (!normalized) return null;
      const result = await pool.query(`SELECT r.manifest FROM artifacts.releases r
        JOIN artifacts.artifacts a ON a.id=r.artifact_id WHERE r.id=$1 AND a.id=$2
        AND a.storage_scope_id=$3 AND a.lifecycle_state='active' AND r.state IN ('ready','retired')`,
      [releaseId, artifactId, scope]);
      if (!result.rows[0]) return null;
      const manifest = JSON.parse(result.rows[0].manifest) as {
        files: Array<{ path: string; digest: string; size: number; mimeType: string }>;
      };
      const file = manifest.files.find((entry) => entry.path === normalized);
      if (!file || !/^sha256:[a-f0-9]{64}$/.test(file.digest)) return null;
      const body = await blobs.getBlob(`artifacts/${scope}/blobs/sha256/${file.digest.slice(7)}`);
      if (!body || body.byteLength !== file.size ||
        createHash("sha256").update(body).digest("hex") !== file.digest.slice(7)) return null;
      if (!["text/html", "text/css", "text/javascript", "application/json"].includes(file.mimeType)) return null;
      return { body, contentType: `${file.mimeType}; charset=utf-8` };
    },
  } };
}
