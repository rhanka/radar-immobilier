import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { applyServiceRoleGrants, IMMO_MCP_ACCOUNT_READER_ROLE, IMMO_MCP_ARTIFACT_WRITER_ROLE }
  from "../../src/db/service-role-grants.js";
import { migrationsFolder } from "./artifacts-h2.helpers.js";

const database = "service_role_grants";
const roles = [IMMO_MCP_ARTIFACT_WRITER_ROLE, IMMO_MCP_ACCOUNT_READER_ROLE];
let admin: pg.Pool;
let pool: pg.Pool;

/** Runs `body` under the restricted role, as the MCP pools do, then rolls back. */
async function asRole<T>(role: string, body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    return await body(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/** Mirrors `pg_restore --no-privileges` on a database created from template0. */
async function stripPrivileges(): Promise<void> {
  for (const role of roles) {
    await pool.query(`REVOKE ALL ON DATABASE ${database} FROM ${role}`);
    await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public, artifacts, drizzle FROM ${role}`);
    await pool.query(`REVOKE ALL ON SCHEMA artifacts, drizzle FROM ${role}`);
  }
}

beforeAll(async () => {
  const env = loadConfig();
  const params = { host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB };
  admin = new pg.Pool(params);
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database} TEMPLATE template0`);
  for (const role of roles) {
    await admin.query(`DO $r$ BEGIN CREATE ROLE ${role} NOLOGIN NOINHERIT;
      EXCEPTION WHEN duplicate_object THEN NULL; END $r$`);
  }
  pool = new pg.Pool({ ...params, database });
  await migrate(drizzle(pool), { migrationsFolder });
  await pool.query("INSERT INTO account_users (sub, status) VALUES ('grant-subject', 'approved')");
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  for (const role of roles) await admin?.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
  await admin?.end();
});

describe("restricted MCP role grants", () => {
  it("restores the artifact writer startup privileges after a privilege-stripping restore", async () => {
    await stripPrivileges();
    await expect(asRole(IMMO_MCP_ARTIFACT_WRITER_ROLE, (c) =>
      c.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS journal")))
      .rejects.toThrow(/permission denied for schema drizzle/);

    await applyServiceRoleGrants(pool);
    await applyServiceRoleGrants(pool); // idempotent replay

    await asRole(IMMO_MCP_ARTIFACT_WRITER_ROLE, async (c) => {
      const journal = await c.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS journal");
      expect(journal.rows[0].journal).not.toBeNull();
      expect((await c.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBeGreaterThan(0);
      await c.query("INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('s', 'o') ON CONFLICT (id) DO NOTHING");
      await c.query("SELECT revision FROM artifacts.host_policy WHERE storage_scope_id = 's' FOR SHARE");
      await c.query("DELETE FROM artifacts.host_actor_rate WHERE storage_scope_id = 's'");
      const account = await c.query("SELECT id, status FROM account_users WHERE sub = 'grant-subject' FOR SHARE");
      expect(account.rows[0].status).toBe("approved");
      await c.query("SELECT workspace_id FROM workspace_memberships WHERE account_id = $1 " +
        "AND status = 'active' AND revoked_at IS NULL FOR SHARE", [account.rows[0].id]);
    });
  });

  it("keeps account tables non-writable and restores the account reader column reads", async () => {
    await stripPrivileges();
    await applyServiceRoleGrants(pool);
    const writes = await pool.query(`SELECT
      has_table_privilege($1, 'public.account_users', 'INSERT,DELETE') AS writer_account_write,
      has_column_privilege($1, 'public.account_users', 'status', 'UPDATE') AS writer_status_update,
      has_table_privilege($2, 'public.account_users', 'INSERT,UPDATE,DELETE') AS reader_account_write,
      has_table_privilege($2, 'public.workspace_memberships', 'INSERT,UPDATE,DELETE') AS reader_membership_write,
      has_schema_privilege($2, 'artifacts', 'USAGE') AS reader_artifacts`,
    [IMMO_MCP_ARTIFACT_WRITER_ROLE, IMMO_MCP_ACCOUNT_READER_ROLE]);
    expect(writes.rows[0]).toEqual({ writer_account_write: false, writer_status_update: false,
      reader_account_write: false, reader_membership_write: false, reader_artifacts: false });
    await asRole(IMMO_MCP_ACCOUNT_READER_ROLE, async (c) => {
      const account = await c.query("SELECT id, status FROM account_users WHERE sub = 'grant-subject' LIMIT 1");
      expect(account.rows[0].status).toBe("approved");
      await c.query("SELECT workspace_id FROM workspace_memberships WHERE account_id = $1 " +
        "AND status = 'active' AND revoked_at IS NULL", [account.rows[0].id]);
    });
  });
});
