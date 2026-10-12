import type pg from "pg";
import { HOST_MIGRATION_LOCK } from "./host-migrations.js";

/** M1 cannot attest active-note conversion. Only empty/deleted-only legacy can retire. */
export async function retireEmptyLegacyNotes(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [HOST_MIGRATION_LOCK]);
    const catalog = await client.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.prospect_notes')::text AS table_name",
    );
    let deletedCount = 0;
    if (catalog.rows[0]?.table_name) {
      await client.query("LOCK TABLE prospect_notes IN ACCESS EXCLUSIVE MODE");
      const counts = await client.query<{ active: string; deleted: string }>(
        `SELECT count(*) FILTER (WHERE deleted_at IS NULL)::text AS active,
                count(*) FILTER (WHERE deleted_at IS NOT NULL)::text AS deleted FROM prospect_notes`,
      );
      if (Number(counts.rows[0]?.active) !== 0) {
        throw new Error("Active legacy notes require verified canonical conversion receipts before retirement");
      }
      deletedCount = Number(counts.rows[0]?.deleted);
      await client.query("DROP TABLE prospect_notes");
      await client.query("DROP TYPE IF EXISTS prospect_note_target");
    }
    await client.query(`CREATE TABLE IF NOT EXISTS drizzle.radar_legacy_retirement
      (id integer PRIMARY KEY CHECK (id = 1), deleted_note_count bigint NOT NULL,
       retired_at timestamptz NOT NULL DEFAULT now())`);
    const receipt = await client.query<{ deleted_note_count: string }>(
      `INSERT INTO drizzle.radar_legacy_retirement(id, deleted_note_count) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET id = 1 RETURNING deleted_note_count`, [deletedCount],
    );
    await client.query("COMMIT");
    return Number(receipt.rows[0]!.deleted_note_count);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
