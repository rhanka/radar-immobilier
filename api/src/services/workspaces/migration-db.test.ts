import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, describeDb, fixture, pool } from "./db-fixture.js";

describeDb("workspace migration and immutable SQL audit", () => {
  afterAll(() => pool.end());

  it("should apply the complete fresh journal and replay without changing its rows", async () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const before = (await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    expect(before).toHaveLength(journal.entries.length);
    expect(Number(before.at(-1).created_at)).toBe(journal.entries.at(-1).when);
    await migrate(db, { migrationsFolder: "drizzle" });
    expect((await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows).toEqual(before);
    await pool.query(readFileSync("drizzle/0017_workspace_memberships.sql", "utf8"));
    expect((await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows).toEqual(before);
  });

  it("should reject audit update, deletion and truncation in Postgres", async () => {
    const f = await fixture();
    const select = () => pool.query("SELECT * FROM workspace_membership_events WHERE workspace_id = $1 ORDER BY id", [f.workspaceId]);
    const before = (await select()).rows;
    expect(before).toHaveLength(5);
    for (const query of [
      "UPDATE workspace_membership_events SET reason = 'synthetic alteration' WHERE workspace_id = $1",
      "DELETE FROM workspace_membership_events WHERE workspace_id = $1",
    ]) {
      await expect(pool.query(query, [f.workspaceId])).rejects.toThrow(/append-only/);
      expect((await select()).rows).toEqual(before);
    }
    await expect(pool.query("TRUNCATE workspace_membership_events")).rejects.toThrow(/append-only/);
    expect((await select()).rows).toEqual(before);
    await expect(pool.query("DELETE FROM workspaces WHERE id = $1", [f.workspaceId])).rejects.toThrow();
  });
});
