import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterEach, expect, it } from "vitest";
import { runLotImport } from "./lot-importer.js";
import { qualifiedLotReport } from "./lot-import-input.js";
import { describeDb, lotFixture } from "./lot-fixture.js";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true }); });

describeDb("6J migration replay", () => {
  it.each([false, true])("should replay 0021 without changing data with follower=%s", async (follower) => {
    const f = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report: qualifiedLotReport(), importKey: randomUUID() },
    { enabled: true });
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; tag: string; when: number; version: string; breakpoints: boolean }>;
    };
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, idx) => idx));
    const entry = journal.entries.find((item) => item.tag === "0021_facet_lot_history")!;
    const previous = journal.entries[entry.idx - 1]!;
    expect(previous.tag).toBe("0020_facet_projection_revisions");
    expect(entry.when).toBeGreaterThan(Math.max(...journal.entries.slice(0, entry.idx).map((item) => item.when)));
    const source = readFileSync(`drizzle/${entry.tag}.sql`, "utf8");
    let migrationsFolder = "drizzle";
    if (follower) {
      mkdirSync("tmp", { recursive: true });
      migrationsFolder = mkdtempSync("tmp/migrations-6j-");
      folders.push(migrationsFolder);
      mkdirSync(`${migrationsFolder}/meta`);
      for (const item of journal.entries) copyFileSync(`drizzle/${item.tag}.sql`, `${migrationsFolder}/${item.tag}.sql`);
      const last = journal.entries.at(-1)!;
      const tag = `${String(Number(last.tag.slice(0, 4)) + 1).padStart(4, "0")}_synthetic_after_6j`;
      writeFileSync(`${migrationsFolder}/${tag}.sql`, "CREATE TABLE IF NOT EXISTS synthetic_after_6j(id INTEGER PRIMARY KEY);");
      journal.entries.push({ idx: journal.entries.length, tag,
        when: Math.max(...journal.entries.map((item) => item.when)) + 1, version: "7", breakpoints: true });
      writeFileSync(`${migrationsFolder}/meta/_journal.json`, JSON.stringify(journal));
      await migrate(f.db, { migrationsFolder });
      await f.pool.query("INSERT INTO synthetic_after_6j(id) VALUES (1)");
    }
    const tables = ["lot_destination_state", "lot_source_rows", "lot_import_runs",
      "lot_capability_grants", "lot_capability_events", "facet_events", "facet_streams",
      "facet_event_bindings", "facet_heads", "prospect_marks"];
    if (follower) tables.push("synthetic_after_6j");
    const snapshot = () => Promise.all(tables.map(async (table) =>
      (await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
    const before = await snapshot();
    await f.pool.query(source);
    expect(await snapshot()).toEqual(before);
    const recorded = (await f.pool.query(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows;
    const deleted = await f.pool.query(
      "DELETE FROM drizzle.__drizzle_migrations WHERE created_at >= $1", [entry.when]);
    expect(deleted.rowCount).toBe(journal.entries.filter((item) => item.when >= entry.when).length);
    await migrate(f.db, { migrationsFolder });
    await migrate(f.db, { migrationsFolder });
    const after = (await f.pool.query(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows;
    expect(after).toEqual(recorded);
    expect(after).toHaveLength(journal.entries.length);
    expect(after.find((row) => Number(row.created_at) === entry.when)?.hash)
      .toBe(createHash("sha256").update(source).digest("hex"));
    expect(await snapshot()).toEqual(before);
  });
});
