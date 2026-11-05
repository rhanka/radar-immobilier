import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { applyServiceRoleGrants, IMMO_MCP_ACCOUNT_READER_ROLE, IMMO_MCP_ARTIFACT_WRITER_ROLE,
  IMMO_MCP_PEOPLE_LOOKUP_ENV, isPeopleLookupEnabled }
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

/**
 * pg-pool's end() resolves as soon as its idle clients are detached, before their sockets
 * close. A following `DROP DATABASE ... WITH (FORCE)` then terminates a still-closing
 * backend; its FATAL 57P01 reaches the client's pool idle listener, re-emitted as a pool
 * 'error' with no listener: an uncaught exception. Wait until every client has really ended.
 */
async function endPoolAndClients(target: pg.Pool): Promise<void> {
  const closing = target.totalCount;
  const ended = new Promise<void>((resolve) => {
    let removed = 0;
    if (closing === 0) resolve();
    target.on("remove", () => { if (++removed >= closing) resolve(); });
  });
  await target.end();
  await ended;
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
  if (pool) await endPoolAndClients(pool);
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

  it("never lets the writer update authorization columns, even after an earlier broader grant", async () => {
    // Earlier revision granted UPDATE (id) and UPDATE (workspace_id); a replay must converge.
    await pool.query(`GRANT UPDATE (id) ON public.account_users TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE}`);
    await pool.query(`GRANT UPDATE (workspace_id) ON public.workspace_memberships TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE}`);
    await applyServiceRoleGrants(pool);
    const columns = await pool.query(`SELECT table_name::text AS t, column_name::text AS c
      FROM information_schema.column_privileges
      WHERE grantee = $1 AND privilege_type = 'UPDATE' AND table_schema = 'public' ORDER BY 1, 2`,
    [IMMO_MCP_ARTIFACT_WRITER_ROLE]);
    expect(columns.rows).toEqual([{ t: "account_users", c: "created_at" }, { t: "workspace_memberships", c: "created_at" }]);
    for (const [table, column] of [["account_users", "status"], ["account_users", "id"], ["account_users", "sub"],
      ["workspace_memberships", "workspace_id"], ["workspace_memberships", "status"],
      ["workspace_memberships", "account_id"], ["workspace_memberships", "revoked_at"]]) {
      await expect(asRole(IMMO_MCP_ARTIFACT_WRITER_ROLE, (c) =>
        c.query(`UPDATE public.${table} SET ${column} = ${column}`)), `${table}.${column}`)
        .rejects.toThrow(/permission denied for table/);
    }
  });

  it("parses the people-lookup migrator flag as strictly opt-in", () => {
    expect(isPeopleLookupEnabled({})).toBe(false);
    expect(isPeopleLookupEnabled({ [IMMO_MCP_PEOPLE_LOOKUP_ENV]: undefined })).toBe(false);
    expect(isPeopleLookupEnabled({ [IMMO_MCP_PEOPLE_LOOKUP_ENV]: "0" })).toBe(false);
    expect(isPeopleLookupEnabled({ [IMMO_MCP_PEOPLE_LOOKUP_ENV]: "true" })).toBe(false);
    expect(isPeopleLookupEnabled({ [IMMO_MCP_PEOPLE_LOOKUP_ENV]: "1" })).toBe(true);
  });

  it("grants name/email reads to the writer only with the flag ON, and revokes them when OFF", async () => {
    await pool.query(`INSERT INTO account_users (sub, status, name, email)
      VALUES ('lookup-subject', 'approved', 'Lookup Subject', 'lookup@example.test')
      ON CONFLICT (sub) DO UPDATE SET name = 'Lookup Subject', email = 'lookup@example.test'`);
    const flagOn = { ...process.env, [IMMO_MCP_PEOPLE_LOOKUP_ENV]: "1" };
    const flagOff = { ...process.env, [IMMO_MCP_PEOPLE_LOOKUP_ENV]: "0" };
    await stripPrivileges();
    await applyServiceRoleGrants(pool, flagOn);
    await applyServiceRoleGrants(pool, flagOn); // idempotent replay
    await asRole(IMMO_MCP_ARTIFACT_WRITER_ROLE, async (c) => {
      const person = await c.query(
        "SELECT name, email FROM account_users WHERE sub = 'lookup-subject'");
      expect(person.rows[0]).toMatchObject({ name: "Lookup Subject", email: "lookup@example.test" });
    });
    // An OFF replay converges back: the two personal-data columns are
    // revoked while the least-privilege (id, sub, status) reads stay.
    await applyServiceRoleGrants(pool, flagOff);
    await expect(asRole(IMMO_MCP_ARTIFACT_WRITER_ROLE, (c) =>
      c.query("SELECT name, email FROM account_users WHERE sub = 'lookup-subject'")))
      .rejects.toThrow(/permission denied/);
    await asRole(IMMO_MCP_ARTIFACT_WRITER_ROLE, async (c) => {
      const account = await c.query("SELECT id, status FROM account_users WHERE sub = 'lookup-subject'");
      expect(account.rows[0].status).toBe("approved");
    });
    // The default (flag unset, as in prod and CI) is OFF as well.
    await applyServiceRoleGrants(pool, flagOn);
    const withoutFlag = { ...process.env };
    delete withoutFlag[IMMO_MCP_PEOPLE_LOOKUP_ENV];
    await applyServiceRoleGrants(pool, withoutFlag);
    await expect(asRole(IMMO_MCP_ARTIFACT_WRITER_ROLE, (c) =>
      c.query("SELECT name FROM account_users WHERE sub = 'lookup-subject'")))
      .rejects.toThrow(/permission denied/);
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
