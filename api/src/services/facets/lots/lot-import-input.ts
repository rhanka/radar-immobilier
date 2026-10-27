/**
 * Synthetic 6F-sourced inputs for 6J importer qualification.
 *
 * Chain A (`mark-6j-0001..0003`, lot 01, real): favori → sollicite →
 * ecarte, so the terminal archive is the only head. Lot 02 carries an
 * exact-boundary market head. Marks 5–6 form a mixed cross-target chain,
 * mark 7 references a missing lot version. Every value is invented.
 */
import { buildLotMigrationReport } from "../lot-migration-report/report.js";
import type { LotMigrationReport } from "../lot-migration-report/manifest.js";
import {
  syntheticInput,
  syntheticLotVersion,
  syntheticMark,
} from "../lot-migration-report/fixtures.js";

export const LOT_6J_AA = "6a000000-0000-4000-8000-0000000000aa";
export const LOT_6J_BB = "6a000000-0000-4000-8000-0000000000bb";

export function lot6jVersions() {
  return [
    syntheticLotVersion({ id: LOT_6J_AA, canonicalId: "lot-canonical-syn-6j-01",
      noLot: "SYN-6J-0001", citySlug: "synthetic-6j-city" }),
    syntheticLotVersion({ id: LOT_6J_BB, canonicalId: "lot-canonical-syn-6j-02",
      noLot: "SYN-6J-0002", citySlug: "synthetic-6j-city" }),
  ];
}

export function lot6jMarks() {
  return [
    syntheticMark({ id: "mark-6j-0001", lotVersionId: LOT_6J_AA, noLot: "SYN-6J-0001",
      citySlug: "synthetic-6j-city", dimension: "pipeline", statut: "favori",
      mode: "real", authorId: "documentary-author-1",
      supersededBy: "mark-6j-0002", createdAt: "2026-01-15T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6j-0002", lotVersionId: LOT_6J_AA, noLot: "SYN-6J-0001",
      citySlug: "synthetic-6j-city", dimension: "pipeline", statut: "sollicite",
      mode: "real", authorId: "documentary-author-1",
      supersedes: "mark-6j-0001", supersededBy: "mark-6j-0003",
      createdAt: "2026-01-16T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6j-0003", lotVersionId: LOT_6J_AA, noLot: "SYN-6J-0001",
      citySlug: "synthetic-6j-city", dimension: "pipeline", statut: "ecarte",
      mode: "real", authorId: "documentary-author-2",
      supersedes: "mark-6j-0002", createdAt: "2026-01-17T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6j-0004", lotVersionId: LOT_6J_BB, noLot: "SYN-6J-0002",
      citySlug: "synthetic-6j-city", dimension: "marche", statut: "en_vente",
      mode: "real", authorId: "documentary-author-3",
      prixDemande: "999999999999.99",
      lienAnnonce: "https://synthetic.invalid/annonce/6j",
      createdAt: "2026-01-18T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6j-0005", lotVersionId: LOT_6J_AA, noLot: "SYN-6J-0001",
      citySlug: "synthetic-6j-city", dimension: "pipeline", statut: "favori",
      mode: "simulation", authorId: "documentary-author-4",
      supersededBy: "mark-6j-0006", createdAt: "2026-01-19T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6j-0006", lotVersionId: LOT_6J_BB, noLot: "SYN-6J-0002",
      citySlug: "synthetic-6j-city", dimension: "pipeline", statut: "ecarte",
      mode: "real", authorId: "documentary-author-4",
      supersedes: "mark-6j-0005", createdAt: "2026-01-20T10:00:00.000Z" }),
    syntheticMark({ id: "mark-6j-0007", lotVersionId: "6a000000-0000-4000-8000-000000009999",
      noLot: "SYN-6J-9999", citySlug: "synthetic-6j-city", dimension: "pipeline",
      statut: "favori", mode: "real", authorId: "documentary-author-5",
      createdAt: "2026-01-21T10:00:00.000Z" }),
  ];
}

/** Qualified mapping (`destinationsQualified: true`) for synthetic tests. */
export function qualifiedLotReport(): LotMigrationReport {
  return buildLotMigrationReport(syntheticInput(lot6jMarks(), lot6jVersions(),
    "mapping-syn-6j-v1", true));
}

/** Unqualified mapping: everything mappable stays pending. */
export function unqualifiedLotReport(): LotMigrationReport {
  return buildLotMigrationReport(syntheticInput(lot6jMarks(), lot6jVersions(),
    "mapping-syn-6j-v1", false));
}
