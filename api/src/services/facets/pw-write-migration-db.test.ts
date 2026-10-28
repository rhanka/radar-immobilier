import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { describeDb, database } from "./scope-db-fixture.js";

describeDb("PW-D migration replay", () => {
  it("should preserve the quota and reader ticket prefix on fresh, upgrade and raw SQL replay", async () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    expect(journal.entries.at(-4)?.tag).toBe("0024_artifacts_coordinator");
    expect(journal.entries.slice(-3).map((entry) => entry.tag)).toEqual([
      "0025_artifacts_actor_quotas", "0026_artifacts_reader_tickets", "0027_pw_write_persistence",
    ]);
    expect(journal.entries.map((entry) => entry.idx)).toEqual([...journal.entries.keys()]);
    expect(journal.entries.at(-1)!.when)
      .toBeGreaterThan(Math.max(...journal.entries.slice(0, -1).map((entry) => entry.when)));
    const fresh = await database();
    const upgrade = await database();
    await upgrade.pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA drizzle CASCADE; DROP SCHEMA artifacts CASCADE");
    mkdirSync("tmp", { recursive: true });
    const folder = mkdtempSync("tmp/pwd-migration-");
    try {
      mkdirSync(`${folder}/meta`);
      const prefix = { ...journal, entries: journal.entries.slice(0, -1) };
      writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify({ ...prefix, entries: prefix.entries.slice(0, -2) }));
      for (const entry of prefix.entries) copyFileSync(`drizzle/${entry.tag}.sql`, `${folder}/${entry.tag}.sql`);
      await migrate(upgrade.db, { migrationsFolder: folder });
      await upgrade.pool.query("INSERT INTO artifacts.storage_scopes(id,org_id) VALUES ('pwd-sentinel','retained')");
      const history = async () => (await upgrade.pool.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
      const baseline = await history();
      writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify(prefix));
      await migrate(upgrade.db, { migrationsFolder: folder });
      const before = await history();
      expect(before.slice(0, -2)).toEqual(baseline);
      expect(before).toHaveLength(baseline.length + 2);
      await migrate(upgrade.db, { migrationsFolder: "drizzle" });
      const after = await history();
      expect(after.slice(0, -1)).toEqual(before);
      expect(after).toHaveLength(before.length + 1);
      await migrate(upgrade.db, { migrationsFolder: "drizzle" });
      await upgrade.pool.query(readFileSync("drizzle/0027_pw_write_persistence.sql", "utf8"));
      expect(await history()).toEqual(after);
      expect((await upgrade.pool.query("SELECT org_id FROM artifacts.storage_scopes WHERE id='pwd-sentinel'")).rows)
        .toEqual([{ org_id: "retained" }]);
      const columns = "SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE table_schema IN ('public','artifacts','drizzle') ORDER BY 1,2,3";
      expect((await upgrade.pool.query(columns)).rows).toEqual((await fresh.pool.query(columns)).rows);
    } finally { rmSync(folder, { recursive: true }); }
  });
});
