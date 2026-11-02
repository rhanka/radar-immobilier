import type pg from "pg";

export const CAS_POLICY_REVISION = "radar-c4-r3-artifacts-cas";

/** Operational migration, separate from schema and startup. Never restores permissive authority. */
export async function migrateArtifactCasPolicy(pool: pg.Pool, scope: string) {
  if (!scope.trim()) throw new Error("artifact_scope_required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const changed = await client.query(`UPDATE artifacts.host_policy SET revision=$2
      WHERE storage_scope_id=$1 AND revision IN ('radar-c4-r2', $2) RETURNING revision`, [scope, CAS_POLICY_REVISION]);
    if (changed.rowCount !== 1) throw new Error("artifact_policy_migration_refused");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
