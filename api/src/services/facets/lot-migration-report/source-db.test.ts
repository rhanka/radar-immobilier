// Source-schema qualification only: all fixtures live in an isolated test DB.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildLotMigrationReport } from "./report.js";
import type { LotVersionRef, SourceMark } from "./types.js";

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB, connectionTimeoutMillis: 3000,
});
const authorId = "6f000000-0000-4000-8000-000000000001";
const lotIds = ["6f000000-0000-4000-8000-000000000002", "6f000000-0000-4000-8000-000000000003"];
const markIds = ["6f000000-0000-4000-8000-000000000004", "6f000000-0000-4000-8000-000000000005"];
const sourceSql = `SELECT id, lot_version_id AS "lotVersionId", no_lot AS "noLot",
  city_slug AS "citySlug", dimension, statut, mode, author_id AS "authorId",
  supersedes, superseded_by AS "supersededBy", prix_demande::text AS "prixDemande",
  lien_annonce AS "lienAnnonce", created_at::text AS "createdAt"
  FROM prospect_marks WHERE city_slug = 'synthetic-6f-db' ORDER BY id`;

describe.skipIf(process.env.LOT_MIGRATION_DB_TEST !== "1")("read-only source snapshot integration", () => {
  beforeAll(async () => {
    await pool.query("INSERT INTO account_users(id, sub) VALUES ($1, 'synthetic-6f-db-author')", [authorId]);
    for (const [i, id] of lotIds.entries()) {
      await pool.query(`INSERT INTO lot_versions
        (id, canonical_id, no_lot, city_slug, valid_from, valid_to, known_from, raw_ref)
        VALUES ($1, 'synthetic-canonical', $2, 'synthetic-6f-db', $3, $4, '2026-01-01', 'synthetic')`,
      [id, `SYNTHETIC-LOT-${i}`, i === 0 ? "2025-01-01" : "2026-01-01", i === 0 ? "2026-01-01" : null]);
      await pool.query(`INSERT INTO prospect_marks
        (id, lot_version_id, no_lot, city_slug, dimension, statut, author_id,
         prix_demande, lien_annonce, created_at)
        VALUES ($1, $2, $3, 'synthetic-6f-db', 'marche', 'en_vente', $4,
          $5, 'https://synthetic.invalid/?x=%2F', '2026-01-01 00:00:00.123456+00')`,
      [markIds[i], id, `SYNTHETIC-LOT-${i}`, authorId, i === 0 ? "999999999999.99" : "0.01"]);
    }
  });
  afterAll(async () => { await pool.end(); });

  it("accounts for real schema rows exactly once without changing the read-only DB", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const before = (await client.query<SourceMark>(sourceSql)).rows;
      const lots = (await client.query<LotVersionRef>(`SELECT id, canonical_id AS "canonicalId",
        no_lot AS "noLot", city_slug AS "citySlug", recon_status AS "reconStatus"
        FROM lot_versions WHERE city_slug = 'synthetic-6f-db' ORDER BY id`)).rows;
      const report = buildLotMigrationReport({ marks: before, lotVersions: lots,
        mapping: { mappingVersion: "synthetic-db-v1", importerVersion: "synthetic-importer-v1", destinationsQualified: false } });
      expect(report.rows.map((row) => row.sourceId)).toEqual(markIds);
      expect(report.counts).toEqual({ sourceEvents: 2, chains: 2, nativeTargets: 1,
        sourceHeads: 2, projectedHeads: 2, conflicts: 2 });
      expect(report.rows.every((row) => row.diagnostics.includes("heads-converged"))).toBe(true);
      expect(report.rows.every((row) => row.diagnostics.includes("destination-collision"))).toBe(true);
      expect(report.rows.map((row) => row.observed.prixDemande)).toEqual(["999999999999.99", "0.01"]);
      expect(report.rows.every((row) => row.observed.authorId === authorId)).toBe(true);
      expect(report.rows[0]?.observed.createdAt).toContain(".123456");
      expect(report.rows[0]?.observed.lienAnnonce).toBe("https://synthetic.invalid/?x=%2F");
      const after = (await client.query<SourceMark>(sourceSql)).rows;
      expect(after).toEqual(before);
      expect(buildLotMigrationReport({ marks: after.reverse(), lotVersions: lots.reverse(),
        mapping: { mappingVersion: "synthetic-db-v1", importerVersion: "synthetic-importer-v1", destinationsQualified: false } }))
        .toEqual(report);
      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
