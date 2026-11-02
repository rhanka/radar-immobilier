import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { FinalizeTxClient } from "@sentropic/artifacts/server/commit-contract";
import { deriveIdempotencyKey } from "./idempotency.js";

/** Structural P0b port (0.2.5 or 0.3.0): no import of an entry point absent from 0.2.2. */
export interface DeleteConfirmationContext {
  actorId: string; storageScopeId: string; artifactId: string;
  expectedCurrentReleaseId: string | null; commandHash: string; internalKey: string;
}
export interface DeleteChallenge extends DeleteConfirmationContext {
  confirmationRef: string; expiresAt: string; approved: boolean; consumed: boolean;
}
interface ChallengeRow {
  confirmation_ref: string; actor_id: string; storage_scope_id: string; artifact_id: string;
  expected_release_id: string | null; command_hash: string; internal_key: string;
  expires_at: Date; approved_at: Date | null; consumed_at: Date | null;
}
const validRef = (value: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
const project = (r: ChallengeRow): DeleteChallenge => ({ confirmationRef: r.confirmation_ref,
  actorId: r.actor_id, storageScopeId: r.storage_scope_id, artifactId: r.artifact_id,
  expectedCurrentReleaseId: r.expected_release_id, commandHash: r.command_hash, internalKey: r.internal_key,
  expiresAt: r.expires_at.toISOString(), approved: r.approved_at !== null, consumed: r.consumed_at !== null });

export function createDeleteConfirmation(pool: pg.Pool, scope: string, appOrigin: string) {
  const origin = new URL(appOrigin);
  if (origin.protocol !== "https:" || origin.origin !== appOrigin) throw new Error("artifact_confirmation_origin_invalid");
  const path = "/api/v1/artifacts/control/delete-confirmations/";
  const read = async (ref: string, actor: string): Promise<DeleteChallenge | undefined> => {
    if (!validRef(ref)) return undefined;
    const result = await pool.query<ChallengeRow>(
      "SELECT * FROM artifacts.delete_confirmations WHERE confirmation_ref=$1 AND storage_scope_id=$2 AND actor_id=$3",
      [ref, scope, actor]);
    return result.rows[0] ? project(result.rows[0]) : undefined;
  };
  return {
    read,
    async approve(ref: string, actor: string): Promise<boolean> {
      if (!validRef(ref)) return false;
      const result = await pool.query(`UPDATE artifacts.delete_confirmations d SET approved_at=now()
        WHERE confirmation_ref=$1 AND d.storage_scope_id=$2 AND d.actor_id=$3
          AND consumed_at IS NULL AND expires_at > now()
          AND EXISTS (SELECT 1 FROM account_users u WHERE u.sub=$3 AND u.status='approved')
          AND EXISTS (SELECT 1 FROM artifacts.artifacts a LEFT JOIN artifacts.artifact_current c ON c.artifact_id=a.id
            WHERE a.id=d.artifact_id AND a.owner_id=$3 AND a.storage_scope_id=$2
              AND a.terminal_deleted_at IS NULL AND c.release_id IS NOT DISTINCT FROM d.expected_release_id)
        RETURNING confirmation_ref`, [ref, scope, actor]);
      return result.rowCount === 1;
    },
    /** Omission preserves the non-CAS public profile; a retry reuses the challenged snapshot. */
    async prepareDelete(actor: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
      if (Object.hasOwn(args, "expectedCurrentReleaseId")) return args;
      const internalKey = deriveIdempotencyKey({ scope, sub: actor, op: "delete",
        artifactId: String(args.artifactId), clientKey: String(args.idempotencyKey) });
      const prior = await pool.query<{ expected_release_id: string | null }>(
        `SELECT expected_release_id FROM artifacts.delete_confirmations
         WHERE storage_scope_id=$1 AND actor_id=$2 AND artifact_id=$3 AND internal_key=$4 ORDER BY created_at DESC LIMIT 1`,
        [scope, actor, args.artifactId, internalKey]);
      if (prior.rows[0]) return { ...args, expectedCurrentReleaseId: prior.rows[0].expected_release_id };
      const current = await pool.query<{ release_id: string | null }>(
        `SELECT c.release_id FROM artifacts.artifacts a LEFT JOIN artifacts.artifact_current c ON c.artifact_id=a.id
         WHERE a.id=$1 AND a.storage_scope_id=$2 AND a.owner_id=$3`, [args.artifactId, scope, actor]);
      return { ...args, expectedCurrentReleaseId: current.rows[0]?.release_id ?? null };
    },
    port: {
      async request(context: DeleteConfirmationContext) {
        if (context.storageScopeId !== scope) throw new Error("artifact_confirmation_scope_mismatch");
        // Separate pool transaction: the challenge survives the refused deletion transaction.
        const result = await pool.query<ChallengeRow>(`INSERT INTO artifacts.delete_confirmations
          (confirmation_ref, storage_scope_id, actor_id, artifact_id, expected_release_id, command_hash, internal_key, expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,now() + interval '10 minutes')
          ON CONFLICT (storage_scope_id, internal_key, command_hash) DO UPDATE SET internal_key=EXCLUDED.internal_key RETURNING *`,
        [randomUUID(), scope, context.actorId, context.artifactId, context.expectedCurrentReleaseId, context.commandHash, context.internalKey]);
        const challenge = project(result.rows[0]!);
        return { confirmationRef: challenge.confirmationRef, managementUrl: `${origin.origin}${path}${challenge.confirmationRef}`,
          expiresAt: challenge.expiresAt };
      },
      async consume(client: FinalizeTxClient, context: DeleteConfirmationContext, ref: string): Promise<"valid" | "invalid" | "expired" | "stale"> {
        if (!validRef(ref) || context.storageScopeId !== scope) return "invalid";
        const result = await client.query<ChallengeRow>(
          "SELECT * FROM artifacts.delete_confirmations WHERE confirmation_ref=$1 FOR UPDATE", [ref]);
        const row = result.rows[0];
        if (!row || row.storage_scope_id !== scope || row.actor_id !== context.actorId || row.artifact_id !== context.artifactId ||
          row.internal_key !== context.internalKey || row.command_hash !== context.commandHash || row.consumed_at) return "invalid";
        if (row.expected_release_id !== context.expectedCurrentReleaseId) return "stale";
        // now() is fixed at BEGIN; expiry must use the DB clock after the row-lock wait.
        const consumed = await client.query(`UPDATE artifacts.delete_confirmations SET consumed_at=clock_timestamp()
          WHERE confirmation_ref=$1 AND expires_at > clock_timestamp() AND approved_at IS NOT NULL AND consumed_at IS NULL RETURNING confirmation_ref`, [ref]);
        if (consumed.rowCount === 1) return "valid";
        const current = await client.query<{ expired: boolean }>(
          "SELECT expires_at <= clock_timestamp() AS expired FROM artifacts.delete_confirmations WHERE confirmation_ref=$1", [ref]);
        return current.rows[0]?.expired ? "expired" : "invalid";
      },
    },
  };
}
export type ArtifactDeleteConfirmation = ReturnType<typeof createDeleteConfirmation>;
