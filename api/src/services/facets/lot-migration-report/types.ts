/**
 * Lot migration report — input contracts (6F, report only).
 *
 * D4: preserve documentary author IDs, never resolve them to owners.
 * The manifest is an inventory, not a logging payload.
 */

export const LOT_MIGRATION_REPORT_VERSION = "lot-migration-report-v1";

export type SourceDimension = "pipeline" | "marche";

export type SourceStatut =
  | "favori"
  | "ecarte"
  | "sollicite"
  | "lettre_envoyee"
  | "en_vente";

export type SourceMode = "real" | "simulation";

/**
 * Verbatim read-only projection of one `prospect_marks` row.
 * Exact prices stay decimal text; timestamps document order only.
 */
export interface SourceMark {
  id: string;
  lotVersionId: string;
  noLot: string;
  citySlug: string;
  dimension: SourceDimension;
  statut: SourceStatut;
  mode: SourceMode;
  authorId: string;
  supersedes: string | null;
  supersededBy: string | null;
  prixDemande: string | null;
  lienAnnonce: string | null;
  createdAt: string;
}

/** Read-only projection of one `lot_versions` row. */
export interface LotVersionRef {
  id: string;
  canonicalId: string;
  noLot: string;
  citySlug: string;
  /** Qualified iff exactly `"validated"`. */
  reconStatus: string;
}

/**
 * Mapping configuration. No workspace, basket, or grant identity lives
 * here: `destinationsQualified` flips only when the 6K owner inputs are
 * established.
 */
export interface LotMigrationMapping {
  mappingVersion: string;
  importerVersion: string;
  destinationsQualified: boolean;
}

export interface LotMigrationInput {
  marks: readonly SourceMark[];
  lotVersions: readonly LotVersionRef[];
  mapping: LotMigrationMapping;
}
