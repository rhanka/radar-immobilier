import type pg from "pg";
import { HOST_MIGRATION_LOCK } from "./host-migrations.js";
import { loadMigrationAssets } from "./migration-assets.js";

/** M1 cannot attest active-note conversion. Only empty/deleted-only legacy can retire. */
export async function retireEmptyLegacyNotes(pool: pg.Pool,
  options: { closedWindowRef: string; migrationsFolder: string }): Promise<number> {
  if (!options.closedWindowRef?.trim()) throw new Error("An authorized closed cutover window is required");
  const hostAsset = (await loadMigrationAssets(options.migrationsFolder)).find((a) => a.tag === "0014_annotations_host")!;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [HOST_MIGRATION_LOCK]);
    const hostCatalog = await client.query<{ installed: boolean }>(`SELECT
      to_regclass('drizzle.radar_migration_steps') IS NOT NULL AND
      to_regclass('public.annotation_tenants') IS NOT NULL AND
      to_regclass('public.annotation_workspaces') IS NOT NULL AND
      to_regclass('public.annotation_memberships') IS NOT NULL AND
      to_regclass('public.annotation_resources') IS NOT NULL AND
      to_regclass('public.annotation_assignment_history') IS NOT NULL AND
      to_regclass('public.annotation_resource_links') IS NOT NULL AS installed`);
    if (!hostCatalog.rows[0]?.installed) throw new Error("Host schema must be installed before retirement");
    const installed = await client.query(`SELECT 1 FROM drizzle.radar_migration_steps s
      JOIN drizzle.__drizzle_migrations m ON m.hash = s.checksum
      WHERE s.tag = $1 AND s.checksum = $2 AND m.created_at = $3`,
    [hostAsset.tag, hostAsset.checksum, hostAsset.when]);
    if (installed.rows.length !== 1) throw new Error("Qualified host migration receipt is required before retirement");
    const catalog = await client.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.prospect_notes')::text AS table_name",
    );
    let deletedCount = 0;
    if (catalog.rows[0]?.table_name) {
      const existing = await client.query<{ receipt: string | null }>(
        "SELECT to_regclass('drizzle.radar_legacy_retirement')::text AS receipt",
      );
      if (existing.rows[0]?.receipt &&
          (await client.query("SELECT 1 FROM drizzle.radar_legacy_retirement WHERE id = 1")).rows.length > 0) {
        throw new Error("Retired legacy catalogue was resurrected; refusing to reuse an old aggregate receipt");
      }
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
       closed_window_ref text NOT NULL, retired_at timestamptz NOT NULL DEFAULT now())`);
    const receipt = await client.query<{ deleted_note_count: string }>(
      `INSERT INTO drizzle.radar_legacy_retirement(id, deleted_note_count, closed_window_ref) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET id = 1 RETURNING deleted_note_count`, [deletedCount, options.closedWindowRef],
    );
    await client.query("COMMIT");
    return Number(receipt.rows[0]!.deleted_note_count);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
