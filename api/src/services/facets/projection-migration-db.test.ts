import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";
import { database, describeDb } from "./scope-db-fixture.js";

describeDb("6L1 projection revision migration", () => {
  it("should upgrade a legacy schema and repair the missing last journal row", async () => {
    const f = await database(true);
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, idx) => idx));
    const entry = journal.entries.find((entry) => entry.tag.endsWith("_facet_projection_revisions"))!;
    expect(entry.when).toBeGreaterThan(Math.max(...journal.entries.slice(0, entry.idx).map((entry) => entry.when)));
    expect(Number(entry.tag.slice(0, 4))).toBe(Number(journal.entries[entry.idx - 1]!.tag.slice(0, 4)) + 1);
    await migrate(f.db, { migrationsFolder: "drizzle" });
    await f.pool.query("INSERT INTO graph_source_revisions(city_slug, revision, content_digest) VALUES ('synthetic-city', 7, 'kept')");
    const before = await f.pool.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id");
    expect(before.rows).toHaveLength(journal.entries.length);
    const hash = createHash("sha256").update(readFileSync(`drizzle/${entry.tag}.sql`)).digest("hex");
    expect(before.rows.at(-1)).toMatchObject({ hash, created_at: String(entry.when) });
    await f.pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [entry.when]);
    await migrate(f.db, { migrationsFolder: "drizzle" });
    await migrate(f.db, { migrationsFolder: "drizzle" });
    const after = await f.pool.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id");
    expect(after.rows).toEqual(before.rows);
    const source = await f.pool.query("SELECT revision, content_digest FROM graph_source_revisions WHERE city_slug = 'synthetic-city'");
    expect(source.rows).toEqual([{ revision: 7, content_digest: "kept" }]);
    for (const table of ["personal_projection_revisions", "workspace_projection_revisions", "graph_source_revisions"]) {
      const constraints = await f.pool.query("SELECT contype FROM pg_constraint WHERE conrelid = $1::regclass", [table]);
      expect(constraints.rows.some((row) => row.contype === "p")).toBe(true);
    }
  });
});
