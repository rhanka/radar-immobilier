import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import { createPostgresArtifactStore } from "@sentropic/artifacts/adapters/postgres";
import { ArtifactConnectionError, withArtifactAdvisoryLock } from "./idempotency.js";

/** Only failures minted by the lock path itself are reported, never body work. */
function isLockFailure(error: unknown): boolean {
  return error instanceof ArtifactConnectionError ||
    (error instanceof Error && error.message.includes("artifact advisory lock timeout conflict"));
}

export const ARTIFACTS_LIFECYCLE_WHEN = 1791200002000;
export const ARTIFACTS_LIFECYCLE_HASH = "fdfbe97f84774b47a207e66915f7426926650e85b6dbb9a4d80272591df624fd";
export const ARTIFACTS_COORDINATOR_WHEN = 1792000000000;
export const ARTIFACTS_COORDINATOR_HASH = "3a262f1bb89cef5c276778e8c21c5e1e8b20d4229aee80e829d1f62815de30cf";

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
  await pool.query(
    "INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [scope, orgId],
  );
  const row = await pool.query("SELECT org_id FROM artifacts.storage_scopes WHERE id = $1", [scope]);
  if (row.rows[0]?.org_id !== orgId) throw new Error("artifact scope organization mismatch");
}

/** Route an execute() and all its work through its leased lock connection.
 * Session locks allow the adapter's putRelease transaction to stay intact.
 * Even five simultaneous lock waiters cannot exhaust the pool underneath work.
 */
export function createLockedArtifactStore(
  pool: pg.Pool, onFailure?: ((error: unknown) => void) | undefined,
) {
  const connections = new AsyncLocalStorage<pg.PoolClient>();
  const routed = new Proxy(pool, {
    get(target, property) {
      const client = connections.getStore();
      if (property === "query" && client) return client.query.bind(client);
      if (property === "connect" && client) {
        return async () => ({ query: client.query.bind(client), release() {} });
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const store = createPostgresArtifactStore(routed);
  return {
    ...store,
    execute<T>(key: string, hash: string, work: () => Promise<T>) {
      const run = withArtifactAdvisoryLock(pool, key, (client) =>
        connections.run(client, () => store.execute(key, hash, work)),
      );
      if (onFailure === undefined) return run;
      return run.catch((error: unknown) => {
        if (isLockFailure(error)) {
          try { onFailure(error); } catch { /* probe failure stays silent */ }
        }
        throw error;
      });
    },
  };
}
