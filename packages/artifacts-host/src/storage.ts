import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import { createPostgresArtifactStore } from "@sentropic/artifacts/adapters/postgres";
import { withArtifactAdvisoryLock } from "./idempotency.js";

export const ARTIFACTS_LIFECYCLE_WHEN = 1791100002000;
export const ARTIFACTS_LIFECYCLE_HASH = "fdfbe97f84774b47a207e66915f7426926650e85b6dbb9a4d80272591df624fd";

/** No DDL at startup. A missing migration disables only artifact operations. */
export async function initializeArtifactScope(
  pool: pg.Pool,
  scope: string,
  orgId: string,
): Promise<boolean> {
  const table = await pool.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS journal");
  if (!table.rows[0]?.journal) return false;
  const migration = await pool.query(
    "SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = $1 AND hash = $2",
    [ARTIFACTS_LIFECYCLE_WHEN, ARTIFACTS_LIFECYCLE_HASH],
  );
  if (!migration.rowCount) return false;
  await pool.query(
    "INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [scope, orgId],
  );
  const row = await pool.query("SELECT org_id FROM artifacts.storage_scopes WHERE id = $1", [scope]);
  return row.rows[0]?.org_id === orgId;
}

/** Route an execute() and all its work through its leased lock connection.
 * Session locks allow the adapter's putRelease transaction to stay intact.
 * Even five simultaneous lock waiters cannot exhaust the pool underneath work.
 */
export function createLockedArtifactStore(pool: pg.Pool) {
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
      return withArtifactAdvisoryLock(pool, key, (client) =>
        connections.run(client, () => store.execute(key, hash, work)),
      );
    },
  };
}
