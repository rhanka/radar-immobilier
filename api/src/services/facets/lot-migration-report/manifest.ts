/**
 * Lot migration report — manifest contracts (6F, report only).
 *
 * One manifest row per source row, sorted by `sourceId`. Exact source
 * values are inventoried without ownership inference or logging.
 */

import type {
  SourceDimension,
  SourceMode,
  SourceStatut,
} from "./types.js";

export type DestinationFacet = "selection" | "pipeline" | "archive" | "market";

export interface DestinationProjection {
  facet: DestinationFacet;
  mode: SourceMode;
  canonicalTarget: string;
  citySlug: string;
}

export type MigrationDiagnosticCode =
  | "target-unresolved"
  | "target-inconsistent"
  | "chain-broken"
  | "chain-cycle"
  | "chain-cross-target"
  | "chain-mixed-mode"
  | "heads-converged"
  | "destination-unqualified"
  | "destination-collision"
  | "import-treatment-required";

export type ManifestDisposition = "mapped" | "conflict" | "unresolved";

export type PriceShape =
  | "absent"
  | "canonical-decimal"
  | "non-canonical"
  | "unexpected-on-pipeline";

export type UrlShape = "absent" | "http-url" | "non-http-url";

/** Exact inventory and value diagnostics; never send this object to logs. */
export interface ObservedSource {
  dimension: SourceDimension;
  statut: SourceStatut;
  mode: SourceMode;
  authorId: string;
  prixDemande: string | null;
  lienAnnonce: string | null;
  priceShape: PriceShape;
  urlShape: UrlShape;
  createdAt: string;
  supersedes: string | null;
  supersededBy: string | null;
  denormalizedNoLot: string;
  denormalizedCity: string;
  lotVersionId: string;
}

/** Exactly one entry per source row, sorted by `sourceId`. */
export interface ManifestRow {
  sourceId: string;
  chainId: string;
  nativeTarget: string;
  targetQualified: boolean;
  disposition: ManifestDisposition;
  diagnostics: MigrationDiagnosticCode[];
  destination: DestinationProjection | null;
  observed: ObservedSource;
}

export interface LotMigrationCounts {
  /** Every source row, each counted once. */
  sourceEvents: number;
  /** Connected supersession components, singletons included. */
  chains: number;
  /** Distinct native targets (canonical id or denormalized fallback). */
  nativeTargets: number;
  /** Rows with no recorded successor. */
  sourceHeads: number;
  /** Heads carrying a destination projection. */
  projectedHeads: number;
  /** Rows whose disposition is `conflict` or `unresolved`. */
  conflicts: number;
}

export interface LotMigrationReport {
  reportVersion: string;
  mappingVersion: string;
  importerVersion: string;
  /** Digest of the canonical source-plus-lot snapshot. */
  sourceSnapshotId: string;
  /** Digest of versions plus every manifest row. */
  manifestSha256: string;
  /** Destination scope still pending while 6K inputs are missing. */
  destinationsQualified: boolean;
  counts: LotMigrationCounts;
  rows: ManifestRow[];
}
