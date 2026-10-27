/**
 * lot-migration-report entry point: report-only lot mapping, no persistence.
 */

export { buildLotMigrationReport } from "./report.js";
export type {
  DestinationFacet,
  DestinationProjection,
  LotMigrationCounts,
  LotMigrationReport,
  ManifestDisposition,
  ManifestRow,
  MigrationDiagnosticCode,
  ObservedSource,
  PriceShape,
  UrlShape,
} from "./manifest.js";
export { LOT_MIGRATION_REPORT_VERSION } from "./types.js";
export type {
  LotMigrationInput,
  LotMigrationMapping,
  LotVersionRef,
  SourceDimension,
  SourceMark,
  SourceMode,
  SourceStatut,
} from "./types.js";
