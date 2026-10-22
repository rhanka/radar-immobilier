import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";
import { database, describeDb } from "./scope-db-fixture.js";

const TARGET_SUFFIX = "_facet_projection_revisions";

interface JournalShape {
  entries: Array<{ idx: number; tag: string; when: number }>;
}

function targetEntry(): { journal: JournalShape; entry: { idx: number; tag: string; when: number } } {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as JournalShape;
  expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, idx) => idx));
  const entry = journal.entries.find((entry) => entry.tag.endsWith(TARGET_SUFFIX))!;
  expect(entry.when).toBeGreaterThan(Math.max(...journal.entries.slice(0, entry.idx).map((entry) => entry.when)));
  expect(Number(entry.tag.slice(0, 4))).toBe(Number(journal.entries[entry.idx - 1]!.tag.slice(0, 4)) + 1);
  return { journal, entry };
}

function targetHash(tag: string): string {
  return createHash("sha256").update(readFileSync(`drizzle/${tag}.sql`)).digest("hex");
}

async function migrationRows(f: Awaited<ReturnType<typeof database>>) {
  return f.pool.query("SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id");
}

describeDb("6L1 projection revision migration", () => {
  it("should upgrade a legacy schema and replay the journal portion from the targeted migration", async () => {
    const { journal, entry } = targetEntry();
    const f = await database(true);
    const hash = targetHash(entry.tag);
    await migrate(f.db, { migrationsFolder: "drizzle" });
    await f.pool.query("INSERT INTO graph_source_revisions(city_slug, revision, content_digest) VALUES ('synthetic-city', 7, 'kept')");
    const before = await migrationRows(f);
    expect(before.rows).toHaveLength(journal.entries.length);
    const targeted = before.rows.find((row) => row.hash === hash);
    expect(targeted).toMatchObject({ hash, created_at: String(entry.when) });
    const targetId = targeted!.id as number;
    await f.pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE id >= $1", [targetId]);
    await migrate(f.db, { migrationsFolder: "drizzle" });
    await migrate(f.db, { migrationsFolder: "drizzle" });
    const after = await migrationRows(f);
    expect(after.rows.slice(0, entry.idx)).toEqual(before.rows.slice(0, entry.idx));
    expect(after.rows.map(({ hash, created_at }) => ({ hash, created_at })))
      .toEqual(before.rows.map(({ hash, created_at }) => ({ hash, created_at })));
    const source = await f.pool.query("SELECT revision, content_digest FROM graph_source_revisions WHERE city_slug = 'synthetic-city'");
    expect(source.rows).toEqual([{ revision: 7, content_digest: "kept" }]);
    for (const table of ["personal_projection_revisions", "workspace_projection_revisions", "graph_source_revisions"]) {
      const constraints = await f.pool.query("SELECT contype FROM pg_constraint WHERE conrelid = $1::regclass", [table]);
      expect(constraints.rows.some((row) => row.contype === "p")).toBe(true);
    }
  });

  it("should keep replaying the targeted portion when a later migration follows it", async () => {
    const { entry } = targetEntry();
    mkdirSync("tmp", { recursive: true });
    const folder = mkdtempSync("tmp/migrations-6l1-");
    try {
      mkdirSync(`${folder}/meta`);
      const stored = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as JournalShape;
      for (const item of stored.entries) copyFileSync(`drizzle/${item.tag}.sql`, `${folder}/${item.tag}.sql`);
      // A synthetic stand-in for a later migration (6J adds its own in parallel):
      // the targeted assertions must hold with a follower present.
      const next = Number(stored.entries.at(-1)!.tag.slice(0, 4)) + 1;
      const laterTag = `${String(next).padStart(4, "0")}_synthetic_after_6l1`;
      writeFileSync(`${folder}/${laterTag}.sql`, "CREATE TABLE IF NOT EXISTS synthetic_after_6l1(id SERIAL PRIMARY KEY);");
      const entries: Array<Record<string, unknown>> = [...stored.entries, { idx: stored.entries.length,
        version: "7", when: Math.max(...stored.entries.map((item) => item.when)) + 1,
        tag: laterTag, breakpoints: true }];
      writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify({ version: "7", dialect: "postgresql", entries }));
      const f = await database(true);
      await migrate(f.db, { migrationsFolder: folder });
      const hash = targetHash(entry.tag);
      const before = await migrationRows(f);
      expect(before.rows).toHaveLength(entries.length);
      const targeted = before.rows.find((row) => row.hash === hash);
      expect(targeted).toMatchObject({ hash, created_at: String(entry.when) });
      const targetId = targeted!.id as number;
      await f.pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE id >= $1", [targetId]);
      await migrate(f.db, { migrationsFolder: folder });
      const after = await migrationRows(f);
      expect(after.rows.slice(0, entry.idx)).toEqual(before.rows.slice(0, entry.idx));
      expect(after.rows.map(({ hash, created_at }) => ({ hash, created_at })))
        .toEqual(before.rows.map(({ hash, created_at }) => ({ hash, created_at })));
      await migrate(f.db, { migrationsFolder: folder });
      expect((await migrationRows(f)).rows).toEqual(after.rows);
    } finally {
      rmSync(folder, { recursive: true });
    }
  });
});
