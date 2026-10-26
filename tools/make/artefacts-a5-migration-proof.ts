import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "../../api/src/config.js";

const config = loadConfig();
const params = { host: config.POSTGRES_HOST, port: config.POSTGRES_PORT, user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD, database: config.POSTGRES_DB };
const admin = new pg.Pool(params);
const journal = JSON.parse(await readFile("api/drizzle/meta/_journal.json", "utf8"));
const prefix = JSON.parse(await readFile("/evidence/baseline-journal.json", "utf8"));
assert.deepEqual(journal.entries.slice(0, -1), prefix.entries);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const checksums = (await readFile("/evidence/baseline-migrations.sha256", "utf8")).trim().split("\n");
for (const line of checksums) {
  const [digest, path] = line.split("  ");
  assert.equal(hash(await readFile(path!)), digest);
}
const coordinator = await readFile(createRequire(import.meta.url).resolve(
  "@sentropic/artifacts/migrations/0003_coordinator.sql"));
assert.ok((await readFile("api/drizzle/0024_artifacts_coordinator.sql")).subarray(0, coordinator.length).equals(coordinator));
const directory = await mkdtemp("/tmp/a5-migration-");
await mkdir(`${directory}/meta`);
await writeFile(`${directory}/meta/_journal.json`, JSON.stringify(prefix));
for (const entry of prefix.entries) await copyFile(`api/drizzle/${entry.tag}.sql`, `${directory}/${entry.tag}.sql`);
const pools: pg.Pool[] = [];
try {
  for (const name of ["a5_migration_upgrade", "a5_migration_fresh"]) {
    await admin.query(`CREATE DATABASE ${name}`);
    pools.push(new pg.Pool({ ...params, database: name }));
  }
  const [upgrade, fresh] = pools as [pg.Pool, pg.Pool];
  await migrate(drizzle(upgrade), { migrationsFolder: directory });
  await upgrade.query("INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ('sentinel', 'preserved')");
  const before = (await upgrade.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
  await migrate(drizzle(upgrade), { migrationsFolder: "api/drizzle" });
  const after = (await upgrade.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
  assert.deepEqual(after.slice(0, -1), before);
  assert.equal(after.length, before.length + 1);
  assert.equal((await upgrade.query("SELECT org_id FROM artifacts.storage_scopes WHERE id = 'sentinel'")).rows[0].org_id, "preserved");
  await migrate(drizzle(upgrade), { migrationsFolder: "api/drizzle" });
  assert.deepEqual((await upgrade.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows, after);
  await migrate(drizzle(fresh), { migrationsFolder: "api/drizzle" });
  const schema = `SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1,2,3`;
  assert.deepEqual((await upgrade.query(schema)).rows, (await fresh.query(schema)).rows);
  await writeFile("/evidence/migration-proof.json", JSON.stringify({ passed: true, prefixEntries: before.length,
    finalEntries: after.length, frozenPrefix: true, publishedCoordinatorBytes: true,
    fresh: true, upgradePreservesData: true, replay: true, schemasEqual: true }, null, 2));
} finally {
  for (const pool of pools) await pool.end();
  for (const name of ["a5_migration_upgrade", "a5_migration_fresh"]) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end(); await rm(directory, { recursive: true });
}
