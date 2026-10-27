import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";

assert(process.cwd() === "/workspace" && process.env.NODE_ENV === "test");
const phase = process.argv[2];
assert(["pristine", "applied", "replayed"].includes(phase));
const { entries } = JSON.parse(readFileSync("api/drizzle/meta/_journal.json", "utf8"));
assert(entries.every((entry, index) => entry.idx === index));
assert.equal(new Set(entries.map((entry) => entry.tag)).size, entries.length);
assert.equal(new Set(entries.map((entry) => entry.when)).size, entries.length);
const coordinator = entries.find((entry) => entry.tag === "0024_artifacts_coordinator");
const quota = entries.find((entry) => entry.tag === "0025_artifacts_actor_quotas");
const reader = entries.find((entry) => entry.tag === "0026_artifacts_reader_tickets");
assert(quota?.idx === 24 && reader?.idx === 25);
assert(coordinator.when < quota.when && quota.when < reader.when);
assert(!existsSync("api/drizzle/0025_artifacts_reader_tickets.sql"));
const pool = new pg.Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB });
try {
  if (phase === "pristine") {
    const { rows } = await pool.query("SELECT to_regclass('public.account_users') AS accounts, to_regclass('drizzle.__drizzle_migrations') AS journal, to_regclass('artifacts.reader_tickets') AS tickets");
    assert.deepEqual(rows[0], { accounts: null, journal: null, tickets: null });
  } else {
    const { rows } = await pool.query("SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id");
    const expected = readMigrationFiles({ migrationsFolder: "api/drizzle" })
      .map((migration) => ({ hash: migration.hash, created_at: String(migration.folderMillis) }));
    assert.deepEqual(rows, expected);
    const tables = ["artifacts.host_actor_quotas", "artifacts.host_actor_rate", "artifacts.reader_tickets"];
    for (const table of tables) assert((await pool.query("SELECT to_regclass($1) AS name", [table])).rows[0].name);
    if (phase === "applied") writeFileSync("/evidence/migrations-first.json", JSON.stringify(rows));
    else assert.deepEqual(rows, JSON.parse(readFileSync("/evidence/migrations-first.json", "utf8")));
  }
  console.log(JSON.stringify({ phase, status: "passed", migrations: entries.length,
    orderedTail: [coordinator, quota, reader].map(({ idx, tag, when }) => ({ idx, tag, when })) }));
} finally { await pool.end(); }
