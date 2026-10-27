import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { loadConfig } from "../../src/config.js";
import { accountAuthorizer } from "../../../packages/immo-mcp/src/account-binding.js";

describeDb("preprod account-reader provisioning", () => {
  it("should authorize current accounts with the documented column grants and no write privilege", async () => {
    const f = await workspaceFixture();
    const role = `synthetic_mcp_${randomUUID().replaceAll("-", "")}`;
    const config = loadConfig();
    let reader: pg.Pool | undefined;
    try {
      const sql = readFileSync("../tools/make/artefacts-delivery-account.sql", "utf8")
        .replaceAll(':"reader"', `"${role}"`).replaceAll(':"database"', `"${f.name}"`)
        .replaceAll(":'reader'", `'${role}'`);
      const results = await f.pool.query(sql);
      const privileges = (results as unknown as pg.QueryResult[]).at(-1)!.rows[0];
      expect(privileges).toEqual({ account_write: false, membership_write: false });
      await f.pool.query(`ALTER ROLE "${role}" PASSWORD 'synthetic-only'`);
      reader = new pg.Pool({ host: config.POSTGRES_HOST, port: config.POSTGRES_PORT,
        database: f.name, user: role, password: "synthetic-only", max: 1 });
      const authorize = accountAuthorizer(reader);
      const request = { principal: { sub: f.contributor.sub,
        attributes: { workspaces: [f.workspaceId] } } } as Parameters<typeof authorize>[1];
      expect(await authorize("search_signals", request)).toBe(true);
      // Even if a client disables the read-only preference, grants forbid writes.
      await reader.query("SET default_transaction_read_only=off");
      await expect(reader.query("UPDATE account_users SET status='approved' WHERE false"))
        .rejects.toMatchObject({ code: "42501" });
      await f.pool.query("UPDATE account_users SET status='suspended' WHERE id=$1", [f.contributor.id]);
      expect(await authorize("search_signals", request)).toBe(false);
      await f.pool.query("UPDATE account_users SET status='approved' WHERE id=$1", [f.contributor.id]);
      await f.pool.query("UPDATE workspace_memberships SET status='revoked', revoked_at=now() WHERE account_id=$1", [f.contributor.id]);
      expect(await authorize("search_signals", request)).toBe(false);
    } finally {
      await reader?.end();
      await f.pool.query(`DROP OWNED BY "${role}"`);
      await f.pool.query(`DROP ROLE "${role}"`);
    }
  });
});
