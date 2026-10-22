import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";
import { runLotImport } from "./lot-importer.js";
import { qualifiedLotReport } from "./lot-import-input.js";
import { describeDb, lotFixture } from "./lot-fixture.js";

describeDb("6J migration replay", () => {
  it("should replay 0020 and re-register its journal without changing data", async () => {
    const f = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report: qualifiedLotReport(), importKey: randomUUID() },
    { enabled: true });
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((item) => item.tag === "0020_facet_lot_history")!;
    const source = readFileSync(`drizzle/${entry.tag}.sql`, "utf8");
    const tables = ["lot_destination_state", "lot_source_rows", "lot_import_runs",
      "lot_capability_grants", "lot_capability_events", "facet_events", "facet_streams",
      "facet_event_bindings", "facet_heads", "prospect_marks"];
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
    await migrate(f.db, { migrationsFolder: "drizzle" });
    await migrate(f.db, { migrationsFolder: "drizzle" });
    const after = (await f.pool.query(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows;
    expect(after).toEqual(recorded);
    expect(after).toHaveLength(journal.entries.length);
    expect(after.find((row) => Number(row.created_at) === entry.when)?.hash)
      .toBe(createHash("sha256").update(source).digest("hex"));
    expect(await snapshot()).toEqual(before);
  });
});
