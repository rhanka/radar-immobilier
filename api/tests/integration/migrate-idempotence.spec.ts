import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db/client.js";

// Same connection pattern as db.spec.ts: a single pg Pool + drizzle db built
// from the test env's POSTGRES_* / DATABASE_URL config, opened at module
// scope and closed in afterAll. No PG-unavailable skip here either — like
// db.spec.ts, this test assumes the integration Postgres is up (booted by
// `make test` / `make test-api` before vitest runs) and lets a connection
// failure fail the test loudly instead of silently skipping it.
const { db, pool } = createDb(loadConfig());

// Absolute path to api/drizzle, independent of the process cwd. Reproduces
// the same migrate() call as api/src/db/migrate.ts (migrationsFolder:
// "drizzle"), but resolved by file URL instead of a bare relative string:
// migrate.ts's "drizzle" only resolves correctly when the process cwd is
// api/ (true for `npm run db:migrate --workspace=api`), which vitest does
// not guarantee.
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

// The journal is the source of truth for "which migration is last" instead
// of a hardcoded count/tag, so this test keeps proving the real drift
// scenario (drop the LAST migration's journal row) even if migrations are
// added after 0012.
const journalPath = fileURLToPath(
  new URL("../../drizzle/meta/_journal.json", import.meta.url),
);
const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
  entries: Array<{ tag: string; when: number }>;
};
const lastEntry = journal.entries[journal.entries.length - 1];
if (!lastEntry) {
  throw new Error(`empty migrations journal at ${journalPath}`);
}

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

afterAll(async () => {
  await pool.end();
});

describe("drizzle migrate() idempotence on a prod-restore journal drift", () => {
  it(
    "re-applies the last migration without error when its journal row is missing but its schema is already present, " +
      "and re-registers exactly that row",
    async () => {
      // Sanity: this test is written against 0012_refresh_document_outcomes
      // being the last migration (idempotent guards added there). If the
      // journal's last entry changes, this assertion fails loudly instead of
      // silently testing the wrong migration's drift.
      expect(lastEntry.tag).toBe("0012_refresh_document_outcomes");

      // ── 1. Known-clean state: (re)apply every migration ────────────────
      // migrate() only replays what is not yet recorded past the latest
      // journal row's created_at, so calling it here is safe whether the
      // test Postgres is already fully migrated (the `make test` /
      // `make test-api` flow runs `db:migrate` before vitest) or genuinely
      // vierge (this file run alone against a fresh Postgres). Either way it
      // converges on a clean database whose journal is complete up to 0012.
      //
      // Deliberately NOT a `DROP SCHEMA public CASCADE`: this Postgres is
      // shared with the other integration spec files in the same test run
      // (db.spec.ts, health.spec.ts, object-store.spec.ts, ...) and dropping
      // the schema would destroy their tables too.
      await migrate(db, { migrationsFolder });

      const beforeCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}"`,
      );
      expect(Number(beforeCount.rows[0]?.count)).toBe(journal.entries.length);

      const typeCountBeforeDrift = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_type WHERE typname = 'refresh_outcome_status'`,
      );
      expect(Number(typeCountBeforeDrift.rows[0]?.count)).toBe(1);

      const lastRowBeforeDrift = await pool.query<{
        id: number;
        hash: string;
        created_at: string;
      }>(
        `SELECT id, hash, created_at FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}" ORDER BY id DESC LIMIT 1`,
      );
      const lastRow = lastRowBeforeDrift.rows[0];
      if (!lastRow) {
        throw new Error(
          `expected at least one row in ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} after migrate()`,
        );
      }
      // Confirms the max-id row really is 0012's row (same folderMillis as
      // the journal's last entry) before we delete it below.
      expect(lastRow.created_at).toBe(String(lastEntry.when));

      // ── 2. Simulate the "restored from prod" drift ──────────────────────
      // The schema already has 0012 (the refresh_outcome_* types + the
      // refresh_document_outcomes table), but its journal row is gone — the
      // bookkeeping is behind the schema, as seen after a prod restore whose
      // dump predates a `drizzle.__drizzle_migrations` insert. Only the
      // journal's bookkeeping row is touched; no application table/column is
      // altered.
      const deleted = await pool.query(
        `DELETE FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}" WHERE id = (SELECT max(id) FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}")`,
      );
      expect(deleted.rowCount).toBe(1);

      const afterDeleteCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}"`,
      );
      expect(Number(afterDeleteCount.rows[0]?.count)).toBe(
        journal.entries.length - 1,
      );

      // Schema untouched by the delete: the type/table from 0012 are still there.
      const typeCountAfterDrift = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_type WHERE typname = 'refresh_outcome_status'`,
      );
      expect(Number(typeCountAfterDrift.rows[0]?.count)).toBe(1);

      // ── 3. Re-run migrate() on the drifted journal ──────────────────────
      // drizzle's migrator compares each migration file's folderMillis
      // against only the remaining last row's created_at (now 0011's), so it
      // decides 0012 needs replaying. Without 0012's idempotent guards (DO/
      // EXCEPTION around the CREATE TYPEs, IF NOT EXISTS on the table/
      // indexes) this throws "type ... already exists". This is the core
      // assertion of this test: it must NOT throw.
      let rerunError: unknown = null;
      try {
        await migrate(db, { migrationsFolder });
      } catch (err) {
        rerunError = err;
      }
      expect(
        rerunError,
        `migrate() must succeed replaying 0012 on a schema that already has it, ` +
          `got: ${String(rerunError)}`,
      ).toBeNull();

      // ── 4. The dropped journal row is re-registered ─────────────────────
      const lastRowAfterRerun = await pool.query<{
        id: number;
        hash: string;
        created_at: string;
      }>(
        `SELECT id, hash, created_at FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}" ORDER BY id DESC LIMIT 1`,
      );
      const rerunRow = lastRowAfterRerun.rows[0];
      if (!rerunRow) {
        throw new Error(
          `expected the ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} row for 0012 to be re-inserted`,
        );
      }
      expect(rerunRow.hash).toBe(lastRow.hash);
      expect(rerunRow.created_at).toBe(lastRow.created_at);

      const afterRerunCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}"`,
      );
      expect(Number(afterRerunCount.rows[0]?.count)).toBe(journal.entries.length);

      // ... and the schema is intact: exactly one type, one table (no
      // duplicate created by the replay).
      const typeCountAfterRerun = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_type WHERE typname = 'refresh_outcome_status'`,
      );
      expect(Number(typeCountAfterRerun.rows[0]?.count)).toBe(1);

      const tableCountAfterRerun = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.tables ` +
          `WHERE table_schema = 'public' AND table_name = 'refresh_document_outcomes'`,
      );
      expect(Number(tableCountAfterRerun.rows[0]?.count)).toBe(1);
    },
  );
});
