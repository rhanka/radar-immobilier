import type pg from "pg";

export const ARTIFACTS_LIFECYCLE_WHEN = 1791200002000;
export const ARTIFACTS_LIFECYCLE_HASH = "fdfbe97f84774b47a207e66915f7426926650e85b6dbb9a4d80272591df624fd";
export const ARTIFACTS_COORDINATOR_WHEN = 1792000000000;
export const ARTIFACTS_COORDINATOR_HASH = "7668c0ce6c7d60174bdfc0004f488ac6be58d59b1d52969b7ac5237040203f6c";
/**
 * L12 per-actor quota tables (0025). Presence-gated, not hash-gated: the
 * migration hash is assigned by drizzle at apply time, so the startup guard
 * checks the relations instead of duplicating the digest. Fail closed either
 * way: a missing 0025 disables artifact operations like any absent migration.
 */
export const ARTIFACTS_ACTOR_QUOTA_TABLE = "artifacts.host_actor_quotas";
export const ARTIFACTS_ACTOR_RATE_TABLE = "artifacts.host_actor_rate";

/** No DDL at startup. A missing migration disables only artifact operations. */
export async function initializeArtifactScope(
  pool: pg.Pool,
  scope: string,
  orgId: string,
): Promise<void> {
  const table = await pool.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS journal");
  if (!table.rows[0]?.journal) throw new Error("artifact schema unavailable: migration journal absent");
  const migration = await pool.query(
    "SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = $1 AND hash = $2",
    [ARTIFACTS_LIFECYCLE_WHEN, ARTIFACTS_LIFECYCLE_HASH],
  );
  if (!migration.rowCount) throw new Error("artifact schema unavailable: 0016 absent or hash mismatch");
  const coordinator = await pool.query(
    "SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = $1 AND hash = $2",
    [ARTIFACTS_COORDINATOR_WHEN, ARTIFACTS_COORDINATOR_HASH],
  );
  if (!coordinator.rowCount) throw new Error("artifact schema unavailable: 0024 absent or hash mismatch");
  const actorQuota = await pool.query("SELECT to_regclass('artifacts.host_actor_quotas') AS journal");
  if (!actorQuota.rows[0]?.journal) throw new Error("artifact schema unavailable: 0025 absent");
  const actorRate = await pool.query("SELECT to_regclass('artifacts.host_actor_rate') AS journal");
  if (!actorRate.rows[0]?.journal) throw new Error("artifact schema unavailable: 0025 absent");
  await pool.query(
    "INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [scope, orgId],
  );
  const row = await pool.query("SELECT org_id FROM artifacts.storage_scopes WHERE id = $1", [scope]);
  if (row.rows[0]?.org_id !== orgId) throw new Error("artifact scope organization mismatch");
}
