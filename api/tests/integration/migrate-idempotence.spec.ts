import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db/client.js";
import { loadMigrationAssets } from "../../src/db/migration-assets.js";
import { runHostMigrations } from "../../src/db/host-migrations.js";
import { retireEmptyLegacyNotes } from "../../src/db/retire-legacy-notes.js";

const config = loadConfig();
const { pool: admin } = createDb(config);
const database = "annotations_migration_test_" + process.pid;
const pool = new pg.Pool({ host: config.POSTGRES_HOST, port: config.POSTGRES_PORT,
  user: config.POSTGRES_USER, password: config.POSTGRES_PASSWORD, database });
const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const assets = await loadMigrationAssets(folder);
beforeAll(async () => { await admin.query('CREATE DATABASE "' + database + '"'); });
afterAll(async () => {
  await pool.end();
  await admin.query('DROP DATABASE "' + database + '"');
  await admin.end();
});

describe("single host migration authority and legacy retirement", () => {
  it("should install every SQL in numeric order, including 0009 and non-monotone journal times", async () => {
    await runHostMigrations(pool, folder);
    const receipts = await pool.query("SELECT hash FROM drizzle.__drizzle_migrations");
    expect(receipts.rows.map((r) => r.hash)).toEqual(assets.map((a) => a.checksum));
    const extension = await pool.query("SELECT count(*)::int AS count FROM drizzle.radar_migration_steps");
    expect(extension.rows[0].count).toBe(assets.length);
    await runHostMigrations(pool, folder);
    expect((await pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(assets.length);
  });

  it("should refuse checksum drift, missing predecessors and unattested manual 0009 without silently repairing", async () => {
    const asset = assets.find((a) => a.tag.startsWith("0005"))!;
    await pool.query("UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE created_at = $2", ["0".repeat(64), asset.when]);
    await expect(runHostMigrations(pool, folder)).rejects.toThrow(/checksum/);
    await pool.query("UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE created_at = $2", [asset.checksum, asset.when]);
    await pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [asset.when]);
    await expect(runHostMigrations(pool, folder)).rejects.toThrow(/predecessor/);
    expect((await pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(assets.length - 1);
    await pool.query("INSERT INTO drizzle.__drizzle_migrations(hash, created_at) VALUES ($1, $2)", [asset.checksum, asset.when]);
    const invitation = assets.find((a) => a.tag.startsWith("0009"))!;
    await pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [invitation.when]);
    await expect(runHostMigrations(pool, folder)).rejects.toThrow(/0009 schema lacks/);
    await pool.query("INSERT INTO drizzle.__drizzle_migrations(hash, created_at) VALUES ($1, $2)", [invitation.checksum, invitation.when]);
  });

  it("should run the deployment entrypoint without retiring active legacy notes", async () => {
    const author = await pool.query("INSERT INTO account_users(sub, status) VALUES ('ordinary-migration-author', 'approved') RETURNING id");
    await pool.query("INSERT INTO prospect_notes(no_lot, city_slug, author_id, body) VALUES ('synthetic-lot', 'synthetic-city', $1, 'synthetic-body')", [author.rows[0].id]);
    try {
      await promisify(execFile)(process.execPath, ["--import", "tsx", "src/db/migrate.ts"], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        env: { ...process.env, POSTGRES_DB: database },
      });
      expect((await pool.query("SELECT count(*)::int AS count FROM prospect_notes")).rows[0].count).toBe(1);
    } finally {
      await pool.query("DELETE FROM prospect_notes WHERE author_id = $1", [author.rows[0].id]);
      await pool.query("DELETE FROM account_users WHERE id = $1", [author.rows[0].id]);
    }
  });

  it("should install schema before refusing active-note retirement and count deleted notes only", async () => {
    const author = await pool.query("INSERT INTO account_users(sub, status) VALUES ('synthetic-legacy-author', 'approved') RETURNING id");
    await pool.query("INSERT INTO prospect_notes(no_lot, city_slug, author_id, body) VALUES ('synthetic-lot', 'synthetic-city', $1, 'synthetic-active-body')", [author.rows[0].id]);
    await expect(retireEmptyLegacyNotes(pool)).rejects.toThrow(/canonical conversion receipts/);
    expect((await pool.query("SELECT body FROM prospect_notes")).rows[0].body).toBe("synthetic-active-body");
    expect((await pool.query("SELECT to_regclass('annotation_workspaces') AS table_name")).rows[0].table_name).toBe("annotation_workspaces");
    await pool.query("UPDATE prospect_notes SET deleted_at = now()");
    expect(await retireEmptyLegacyNotes(pool)).toBe(1);
    expect((await pool.query("SELECT to_regclass('prospect_notes') AS table_name")).rows[0].table_name).toBeNull();
    expect((await pool.query("SELECT count(*)::int AS count FROM pg_type WHERE typname = 'prospect_note_target'")).rows[0].count).toBe(0);
    const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'drizzle' AND table_name = 'radar_legacy_retirement'");
    expect(columns.rows.map((r) => r.column_name)).toEqual(["id", "deleted_note_count", "retired_at"]);
    expect(await retireEmptyLegacyNotes(pool)).toBe(1);
    await runHostMigrations(pool, folder);
    expect((await pool.query("SELECT to_regclass('prospect_notes') AS table_name")).rows[0].table_name).toBeNull();
  });
});
