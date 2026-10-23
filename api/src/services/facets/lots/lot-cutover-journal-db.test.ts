/**
 * 6K migration replay: 0022 replays without changing data and tolerates a
 * later migration. The journal assertions locate 0022 by tag and never
 * assume it is the last entry. Synthetic disposable database.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterEach, expect, it } from "vitest";
import {
  describeDb,
  cutoverFixture,
} from "./cutover-fixture.js";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true }); });

describeDb("6K migration replay", () => {
  it.each(["0022_facet_lot_cutover", "0023_facet_lot_versions_fence"])(
    "should replay %s without changing data and tolerate a later migration", async (tag) => {
    const f = await cutoverFixture();
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; tag: string; when: number; version: string; breakpoints: boolean }>;
    };
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, idx) => idx));
    const entry = journal.entries.find((item) => item.tag === tag)!;
    expect(entry).toBeDefined();
    const prerequisites = ["0020_facet_projection_revisions", "0021_facet_lot_history",
      "0022_facet_lot_cutover", "0023_facet_lot_versions_fence"];
    const positions = prerequisites.map((prerequisite) => {
      const matches = journal.entries.filter((item) => item.tag === prerequisite);
      expect(matches).toHaveLength(1);
      return journal.entries.indexOf(matches[0]!);
    });
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    }
    expect(entry.when).toBeGreaterThan(Math.max(
      ...journal.entries.slice(0, entry.idx).map((item) => item.when)));
    const source = readFileSync(`drizzle/${entry.tag}.sql`, "utf8");
    const tables = ["lot_cutover_state", "lot_cutover_events", "lot_d5_dispositions",
      "lot_source_writer_coverage", "prospect_marks", "lot_versions", "lot_legacy_fence"];
    const snapshot = () => Promise.all(tables.map(async (table) =>
      (await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
    const before = await snapshot();
    await f.pool.query(source);
    expect(await snapshot()).toEqual(before);
    mkdirSync("tmp", { recursive: true });
    const migrationsFolder = mkdtempSync("tmp/migrations-6k-");
    folders.push(migrationsFolder);
    mkdirSync(`${migrationsFolder}/meta`);
    for (const item of journal.entries) copyFileSync(`drizzle/${item.tag}.sql`, `${migrationsFolder}/${item.tag}.sql`);
    const last = journal.entries.at(-1)!;
    const follower = `${String(Number(last.tag.slice(0, 4)) + 1).padStart(4, "0")}_synthetic_after_6k`;
    writeFileSync(`${migrationsFolder}/${follower}.sql`,
      "CREATE TABLE IF NOT EXISTS synthetic_after_6k(id INTEGER PRIMARY KEY);");
    const followerJournal = {
      ...journal,
      entries: [...journal.entries, { idx: journal.entries.length, tag: follower,
        when: Math.max(...journal.entries.map((item) => item.when)) + 1,
        version: "7", breakpoints: true }],
    };
    writeFileSync(`${migrationsFolder}/meta/_journal.json`, JSON.stringify(followerJournal));
    await migrate(f.db, { migrationsFolder });
    await migrate(f.db, { migrationsFolder });
    await f.pool.query("INSERT INTO synthetic_after_6k(id) VALUES (1)");
    expect(await snapshot()).toEqual(before);
    const recorded = (await f.pool.query(
      "SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = $1", [entry.when])).rows;
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.hash).toBe(createHash("sha256").update(source).digest("hex"));
  });
});
