import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const first = JSON.parse(readFileSync("/evidence/first-track.json", "utf8"));
assert.ok(Number.isInteger(first.count) && first.count > 21 && first.count < journal.entries.length);
const expected = journal.entries.map((entry) => ({
  hash: createHash("sha256").update(readFileSync(`drizzle/${entry.tag}.sql`)).digest("hex"),
  created_at: String(entry.when),
}));
const connection = { host: process.env.POSTGRES_HOST, user: "radar", password: "synthetic-only" };
const admin = new pg.Pool({ ...connection, database: "radar" });
const name = `synthetic_ct8_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE DATABASE "${name}"`);
const pool = new pg.Pool({ ...connection, database: name }), db = drizzle(pool);
const folder = `tmp/${name}`, receipts = [];
try {
  for (const count of [21, first.count, journal.entries.length]) {
    mkdirSync(`${folder}/meta`, { recursive: true });
    const entries = journal.entries.slice(0, count);
    for (const entry of entries) copyFileSync(`drizzle/${entry.tag}.sql`, `${folder}/${entry.tag}.sql`);
    writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify({ ...journal, entries }));
    await migrate(db, { migrationsFolder: folder });
    if (count === 21) {
      await pool.query("CREATE TABLE synthetic_l5_probe(id integer PRIMARY KEY,value text)");
      await pool.query("INSERT INTO synthetic_l5_probe VALUES(1,'retained')");
    }
    const history = async () => (await pool.query(
      "SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    assert.deepEqual(await history(), expected.slice(0, count));
    await migrate(db, { migrationsFolder: folder });
    assert.deepEqual(await history(), expected.slice(0, count));
    assert.deepEqual((await pool.query("SELECT * FROM synthetic_l5_probe")).rows, [{ id: 1, value: "retained" }]);
    receipts.push({ count, history: await history(), retained: true, rerun: true });
  }
  writeFileSync("/evidence/ct8-staged.json", JSON.stringify({ first, receipts }, null, 2));
  console.log(`CT8 PASS baseline 21 → main ${first.count} → combined ${expected.length}, each rerun and retained`);
} finally {
  await pool.end(); await admin.query(`DROP DATABASE "${name}"`); await admin.end();
  rmSync(folder, { recursive: true, force: true });
}
