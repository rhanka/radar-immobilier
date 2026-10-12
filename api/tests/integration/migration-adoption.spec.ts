import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db/client.js";
import { runHostMigrations } from "../../src/db/host-migrations.js";
import { loadMigrationAssets } from "../../src/db/migration-assets.js";
import { retireEmptyLegacyNotes } from "../../src/db/retire-legacy-notes.js";

const config = loadConfig();
const { pool: admin } = createDb(config);
const database = "annotations_adoption_" + process.pid;
const poolOptions = { host: config.POSTGRES_HOST, port: config.POSTGRES_PORT,
  user: config.POSTGRES_USER, password: config.POSTGRES_PASSWORD, database };
let pool = new pg.Pool(poolOptions);
const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const assets = await loadMigrationAssets(folder);
let oldFolder: string;

beforeAll(async () => {
  await admin.query('CREATE DATABASE "' + database + '"');
  oldFolder = await mkdtemp(join(tmpdir(), "annotations-adoption-"));
  await cp(folder, oldFolder, { recursive: true });
  const path = join(oldFolder, "meta/_journal.json");
  const journal = JSON.parse(await readFile(path, "utf8")) as { entries: Array<{ tag: string }> };
  journal.entries = journal.entries.filter((e) => Number(e.tag.slice(0, 4)) <= 13);
  await writeFile(path, JSON.stringify(journal));
  await migrate(drizzle(pool), { migrationsFolder: oldFolder });
});
afterAll(async () => {
  await pool.end();
  await admin.query('DROP DATABASE "' + database + '"');
  await admin.end();
  await rm(oldFolder, { recursive: true, force: true });
});

describe("adoption of native Drizzle history", () => {
  it("should refuse an unqualified manual 0009 without mutation", async () => {
    await expect(retireEmptyLegacyNotes(pool, { closedWindowRef: "synthetic-window", migrationsFolder: folder }))
      .rejects.toThrow(/Host schema/);
    const migration = assets.find((a) => a.tag.startsWith("0009"))!;
    for (const sql of migration.statements) await pool.query(sql);
    await expect(runHostMigrations(pool, folder)).rejects.toThrow(/explicit catalog attestation/);
    expect((await pool.query("SELECT to_regclass('annotation_tenants') AS t")).rows[0].t).toBeNull();
    expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(13);
  });

  it("should reject a divergent catalog even with operator authority", async () => {
    await pool.query("DROP INDEX account_invitations_email_idx");
    await expect(runHostMigrations(pool, folder, { attestationRef: "synthetic-window" })).rejects.toThrow(/catalog/);
    expect((await pool.query("SELECT to_regclass('drizzle.radar_migration_steps') AS t")).rows[0].t).toBeNull();
    await pool.query("CREATE INDEX account_invitations_email_idx ON account_invitations(email)");
  });

  it("should attest under the host authority without replaying data and recover a missing final native receipt", async () => {
    await pool.query("INSERT INTO account_invitations(email, token, invited_by) VALUES ('synthetic@example.invalid', 'synthetic-token', 'synthetic-author')");
    const last = assets.find((a) => a.tag.startsWith("0013"))!;
    await pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [last.when]);
    await runHostMigrations(pool, folder, { attestationRef: "synthetic-window" });
    expect((await pool.query("SELECT count(*)::int AS n FROM account_invitations")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(15);
    const attestation = await pool.query("SELECT authority_ref, catalog_digest FROM drizzle.radar_migration_attestations");
    expect(attestation.rows).toEqual([{ authority_ref: "synthetic-window", catalog_digest: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    await runHostMigrations(pool, folder);
    expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.radar_migration_attestations")).rows[0].n).toBe(1);
  });

  it("should roll back only the failing DDL step and retry without repeating committed predecessors", async () => {
    const failing = await mkdtemp(join(tmpdir(), "annotations-failing-step-"));
    try {
      await cp(folder, failing, { recursive: true });
      const path = join(failing, "meta/_journal.json");
      const journal = JSON.parse(await readFile(path, "utf8")) as { entries: unknown[] };
      journal.entries.push({ idx: journal.entries.length, tag: "0015_synthetic_failure", when: 1_900_000_000_000 });
      await writeFile(path, JSON.stringify(journal));
      await writeFile(join(failing, "0015_synthetic_failure.sql"),
        "CREATE TABLE synthetic_rolled_back(id int);--> statement-breakpoint SELECT missing_synthetic_function();");
      await expect(runHostMigrations(pool, failing)).rejects.toThrow(/missing_synthetic_function/);
      expect((await pool.query("SELECT to_regclass('synthetic_rolled_back') AS t")).rows[0].t).toBeNull();
      expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(15);
      await Promise.all([runHostMigrations(pool, folder), runHostMigrations(pool, folder)]);
      expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(15);
    } finally { await rm(failing, { recursive: true, force: true }); }
  });

  it("should keep a pre-adoption restore closed for explicit retirement and never recreate legacy after adoption", async () => {
    const cutover = { closedWindowRef: "synthetic-closed-window", migrationsFolder: folder };
    for (const phase of ["before", "after"]) {
      const restoredName = database + "_restored";
      await pool.end();
      await admin.query('CREATE DATABASE "' + restoredName + '" TEMPLATE "' + database + '"');
      pool = new pg.Pool(poolOptions);
      const restored = new pg.Pool({ ...poolOptions, database: restoredName });
      try {
        await runHostMigrations(restored, folder);
        const catalog = await restored.query("SELECT to_regclass('prospect_notes') AS t");
        expect(catalog.rows[0].t).toBe(phase === "before" ? "prospect_notes" : null);
        await expect(retireEmptyLegacyNotes(restored, { ...cutover, closedWindowRef: "" })).rejects.toThrow(/window/);
        expect(await retireEmptyLegacyNotes(restored, cutover)).toBe(0);
        await runHostMigrations(restored, folder);
        expect((await restored.query("SELECT to_regclass('prospect_notes') AS t")).rows[0].t).toBeNull();
      } finally {
        await restored.end();
        await admin.query('DROP DATABASE "' + restoredName + '"');
      }
      if (phase === "before") await retireEmptyLegacyNotes(pool, cutover);
    }
  });
});
