import { randomUUID, createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db/client.js";

it("should apply 0047 then 0048 then 0049 exactly once when upgrading an existing database", async () => {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const tail = [47, 48, 49].map((number) => {
    const entry = journal.entries.find((item) => Number(item.tag.slice(0, 4)) === number);
    expect(entry, `Merge #1104 then #1107 before #1108: migration ${number} is required`).toBeDefined();
    return entry!;
  });
  expect(tail[0]!.when).toBeLessThan(tail[1]!.when);
  expect(tail[1]!.when).toBeLessThan(tail[2]!.when);
  const name = `migration_sequence_${randomUUID().replaceAll("-", "")}`;
  const admin = createDb(loadConfig());
  const handle = createDb({ ...loadConfig(), POSTGRES_DB: name });
  mkdirSync("tmp", { recursive: true });
  const folder = mkdtempSync("tmp/migration-sequence-");
  try {
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    mkdirSync(`${folder}/meta`);
    for (const entry of journal.entries) copyFileSync(`drizzle/${entry.tag}.sql`, `${folder}/${entry.tag}.sql`);
    for (const number of [46, 47, 48, 49]) {
      const entries = journal.entries.filter((entry) => Number(entry.tag.slice(0, 4)) <= number);
      writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify({ ...journal, entries }));
      await migrate(handle.db, { migrationsFolder: folder });
      await migrate(handle.db, { migrationsFolder: folder });
      const rows = await handle.pool.query("SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id");
      expect(rows.rows).toEqual(entries.map((entry) => ({
        hash: createHash("sha256").update(readFileSync(`drizzle/${entry.tag}.sql`)).digest("hex"),
        created_at: String(entry.when),
      })));
    }
    for (const relation of ["signal_class_feedback", "signal_mcp_events", "signal_metadata", "signal_metadata_versions"]) {
      const result = await handle.pool.query("SELECT to_regclass($1) AS name", [relation]);
      expect(result.rows[0]?.name).toBe(relation);
    }
  } finally {
    await handle.pool.end();
    await admin.pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.pool.end();
    rmSync(folder, { recursive: true });
  }
});
