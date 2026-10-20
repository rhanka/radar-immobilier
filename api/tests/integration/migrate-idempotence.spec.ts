import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

type MigrationJournalRow = { hash: string; created_at: string };

// Shared read helpers for the drift scenarios below. They only read the
// migration journal and the migrated schema; they never alter either.
async function countJournalRows(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}"`,
  );
  return Number(result.rows[0]?.count);
}

async function readJournalRowsSince(
  since: string,
): Promise<MigrationJournalRow[]> {
  const result = await pool.query<MigrationJournalRow>(
    `SELECT hash, created_at FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}" WHERE created_at >= $1 ORDER BY created_at ASC`,
    [since],
  );
  return result.rows.map((row) => ({
    hash: row.hash,
    created_at: String(row.created_at),
  }));
}

async function expectCodebookIntact(): Promise<void> {
  const codes = await pool.query<{ verdict: string; count: number }>(
    `SELECT verdict, count(*)::int AS count FROM facet_reason_codes
     WHERE profile_id = 'immo-steve-2026-09' GROUP BY verdict ORDER BY verdict`,
  );
  expect(codes.rows).toEqual([
    { verdict: "a_surveiller", count: 8 },
    { verdict: "non_pertinent", count: 12 },
    { verdict: "pertinent", count: 8 },
  ]);
  const precedent = await pool.query(
    `SELECT verdict FROM facet_reason_codes WHERE code = 'V2-PRECEDENT'`,
  );
  expect(precedent.rows).toEqual([{ verdict: "non_pertinent" }]);
}

async function expectRelationPresent(name: string): Promise<void> {
  const found = await pool.query<{ relation: string | null }>(
    "SELECT to_regclass($1) AS relation",
    [name],
  );
  expect(found.rows[0]?.relation).toBe(name);
}

afterAll(async () => {
  await pool.end();
});

describe("drizzle migrate() idempotence on a prod-restore journal drift", () => {
  it(
    "re-applies the last migration without error when its journal row is missing but its schema is already present, " +
      "and re-registers exactly that row",
    async () => {
      expect(journal.entries.at(-3)).toMatchObject({ tag: "0014_facets_signal", when: 1791200000000 });
      expect(lastEntry.tag).toBe("0016_artifacts_lifecycle");
      // The journal selects the current last migration, including appended
      // package migrations. Its persisted hash must match those exact bytes.
      const expectedHash = createHash("sha256")
        .update(readFileSync(`${migrationsFolder}/${lastEntry.tag}.sql`)).digest("hex");

      // ── 1. Known-clean state: (re)apply every migration ────────────────
      // migrate() only replays what is not yet recorded past the latest
      // journal row's created_at, so calling it here is safe whether the
      // test Postgres is already fully migrated (the `make test` /
      // `make test-api` flow runs `db:migrate` before vitest) or genuinely
      // vierge (this file run alone against a fresh Postgres). Either way it
      // converges on a clean database whose journal is complete up to 0016.
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
      const lifecycleBefore = await pool.query("SELECT to_regclass('artifacts.artifact_access') AS relation");
      expect(lifecycleBefore.rows[0]?.relation).toBe("artifacts.artifact_access");

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
      // Confirms the max-id row really is 0016's row (same folderMillis as
      // the journal's last entry) before we delete it below.
      expect(lastRow.created_at).toBe(String(lastEntry.when));
      expect(lastRow.hash).toBe(expectedHash);

      // ── 2. Simulate the "restored from prod" drift ──────────────────────
      // The schema already has 0016 (artifact lifecycle, sources and grants),
      // but its journal row is gone — the
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

      // Earlier application schema is untouched by this journal-only drift.
      const typeCountAfterDrift = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_type WHERE typname = 'refresh_outcome_status'`,
      );
      expect(Number(typeCountAfterDrift.rows[0]?.count)).toBe(1);
      const lifecycleAfterDrift = await pool.query("SELECT to_regclass('artifacts.artifact_access') AS relation");
      expect(lifecycleAfterDrift.rows[0]?.relation).toBe("artifacts.artifact_access");

      // ── 3. Re-run migrate() on the drifted journal ──────────────────────
      // drizzle's migrator compares each migration file's folderMillis
      // against only the remaining last row's created_at (now 0015's), so it
      // replays 0016's guarded columns, constraint and tables/indexes.
      let rerunError: unknown = null;
      try {
        await migrate(db, { migrationsFolder });
      } catch (err) {
        rerunError = err;
      }
      expect(
        rerunError,
        `migrate() must succeed replaying 0016 on a schema that already has it, ` +
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
          `expected the ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} row for 0016 to be re-inserted`,
        );
      }
      expect(rerunRow.hash).toBe(lastRow.hash);
      expect(rerunRow.created_at).toBe(lastRow.created_at);
      const lifecycleAfterReplay = await pool.query("SELECT to_regclass('artifacts.artifact_access') AS relation");
      expect(lifecycleAfterReplay.rows[0]?.relation).toBe("artifacts.artifact_access");

      // 0013 replayed on a schema that already has it: the PK stays (city_slug, id).
      const pkAfterRerun = await pool.query<{ cols: string[] }>(
        `SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum)) AS cols
           FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = 'graph_nodes'::regclass AND c.contype = 'p'`,
      );
      expect(pkAfterRerun.rows[0]?.cols).toEqual(["city_slug", "id"]);

      const afterRerunCount = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}"`,
      );
      expect(Number(afterRerunCount.rows[0]?.count)).toBe(journal.entries.length);

      const codes = await pool.query<{ verdict: string; count: number }>(
        `SELECT verdict, count(*)::int AS count FROM facet_reason_codes
         WHERE profile_id = 'immo-steve-2026-09' GROUP BY verdict ORDER BY verdict`,
      );
      expect(codes.rows).toEqual([
        { verdict: "a_surveiller", count: 8 },
        { verdict: "non_pertinent", count: 12 },
        { verdict: "pertinent", count: 8 },
      ]);
      const precedent = await pool.query(
        `SELECT verdict FROM facet_reason_codes WHERE code = 'V2-PRECEDENT'`,
      );
      expect(precedent.rows).toEqual([{ verdict: "non_pertinent" }]);

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

  it(
    "re-applies 0014_facets_signal with 0015 and 0016 when every journal row from 0014 onward is missing, " +
      "and re-registers those rows with identical hashes and timestamps",
    async () => {
      // drizzle's migrator replays a migration file only when its folderMillis
      // is newer than the created_at of the LAST REMAINING journal row, so
      // deleting only 0014's row would never replay 0014 (0016's row would
      // still be the cutoff). The drift must drop every row from 0014 onward:
      // 0014, 0015 and 0016. The cutoff is read from the journal by tag, so no
      // timestamp is hardcoded here.
      const replayStart = journal.entries.findIndex(
        (entry) => entry.tag === "0014_facets_signal",
      );
      expect(replayStart).toBeGreaterThanOrEqual(0);
      const replayEntries = journal.entries.slice(replayStart);
      expect(replayEntries.map((entry) => entry.tag)).toEqual([
        "0014_facets_signal",
        "0015_artifacts_core",
        "0016_artifacts_lifecycle",
      ]);
      const firstReplay = replayEntries[0];
      if (!firstReplay) {
        throw new Error(
          "expected 0014_facets_signal in the migrations journal",
        );
      }
      const replaySince = String(firstReplay.when);

      // ── 1. Known-clean state: (re)apply every migration ────────────────
      // Same shared-Postgres discipline as the first scenario (no DROP
      // SCHEMA): this Postgres is shared with the other integration specs.
      await migrate(db, { migrationsFolder });
      expect(await countJournalRows()).toBe(journal.entries.length);

      const rowsBeforeDrift = await readJournalRowsSince(replaySince);
      expect(rowsBeforeDrift).toHaveLength(replayEntries.length);

      // ── 2. Simulate the drift: journal behind the schema from 0014 on ──
      // Only journal bookkeeping rows are touched; no application table is
      // altered, mirroring a restore whose dump predates those inserts.
      const deleted = await pool.query(
        `DELETE FROM ${MIGRATIONS_SCHEMA}."${MIGRATIONS_TABLE}" WHERE created_at >= $1`,
        [replaySince],
      );
      expect(deleted.rowCount).toBe(replayEntries.length);
      expect(await countJournalRows()).toBe(
        journal.entries.length - replayEntries.length,
      );

      // ── 3. Re-run migrate() on the drifted journal ─────────────────────
      let rerunError: unknown = null;
      try {
        await migrate(db, { migrationsFolder });
      } catch (err) {
        rerunError = err;
      }
      expect(
        rerunError,
        `migrate() must succeed replaying 0014, 0015 and 0016 on a schema that already has them, ` +
          `got: ${String(rerunError)}`,
      ).toBeNull();

      // ── 4. The dropped rows are re-registered identically ──────────────
      // Row ids are new (appended), but each migration's hash and created_at
      // must match the state captured before the drift.
      const rowsAfterReplay = await readJournalRowsSince(replaySince);
      expect(rowsAfterReplay).toEqual(rowsBeforeDrift);
      expect(await countJournalRows()).toBe(journal.entries.length);

      // The 0014 codebook survives its replay (INSERT ... ON CONFLICT DO
      // NOTHING): 28 codes, 8 watched / 12 out of scope / 8 selected.
      await expectCodebookIntact();

      // ... and the artifact objects from 0015 (core) and 0016 (lifecycle)
      // are intact, not duplicated by the replay.
      await expectRelationPresent("artifacts.artifacts");
      await expectRelationPresent("artifacts.artifact_access");
    },
  );
});
