/**
 * Synthetic fixtures for lot-migration-report tests.
 *
 * Every value is invented: synthetic lot numbers, synthetic cities, and
 * fixed UUID-like ids. No operational data or real author identity.
 */

import type { ManifestRow } from "./manifest.js";
import type {
  LotMigrationInput,
  LotVersionRef,
  SourceMark,
} from "./types.js";

/** Index manifest diagnostics by source id for compact assertions. */
export function diagnosticsById(
  rows: ManifestRow[],
): Record<string, readonly string[]> {
  return Object.fromEntries(
    rows.map((row) => [row.sourceId, row.diagnostics]),
  );
}

let sequence = 0;

function syntheticId(prefix: string): string {
  sequence += 1;
  return `${prefix}-syn-${String(sequence).padStart(4, "0")}`;
}

export function resetSyntheticIds(): void {
  sequence = 0;
}

export interface SyntheticMarkOptions {
  id?: string;
  lotVersionId?: string;
  noLot?: string;
  citySlug?: string;
  dimension?: SourceMark["dimension"];
  statut?: SourceMark["statut"];
  mode?: SourceMark["mode"];
  authorId?: string;
  supersedes?: string | null;
  supersededBy?: string | null;
  prixDemande?: string | null;
  lienAnnonce?: string | null;
  createdAt?: string;
}

export function syntheticMark(options: SyntheticMarkOptions = {}): SourceMark {
  return {
    id: options.id ?? syntheticId("mark"),
    lotVersionId: options.lotVersionId ?? "lot-version-syn-0001",
    noLot: options.noLot ?? "LOT-SYN-0001",
    citySlug: options.citySlug ?? "ville-synth-report",
    dimension: options.dimension ?? "pipeline",
    statut: options.statut ?? "favori",
    mode: options.mode ?? "real",
    authorId: options.authorId ?? "author-synthetic-1",
    supersedes: options.supersedes ?? null,
    supersededBy: options.supersededBy ?? null,
    prixDemande: options.prixDemande ?? null,
    lienAnnonce: options.lienAnnonce ?? null,
    createdAt: options.createdAt ?? "2026-01-15T10:00:00.000Z",
  };
}

export interface SyntheticLotOptions {
  id?: string;
  canonicalId?: string;
  noLot?: string;
  citySlug?: string;
  reconStatus?: string;
}

export function syntheticLotVersion(
  options: SyntheticLotOptions = {},
): LotVersionRef {
  return {
    id: options.id ?? "lot-version-syn-0001",
    canonicalId: options.canonicalId ?? "lot-canonical-syn-0001",
    noLot: options.noLot ?? "LOT-SYN-0001",
    citySlug: options.citySlug ?? "ville-synth-report",
    reconStatus: options.reconStatus ?? "validated",
  };
}

export function syntheticInput(
  marks: SourceMark[],
  lots: LotVersionRef[],
  mappingVersion = "mapping-syn-v1",
  destinationsQualified = false,
): LotMigrationInput {
  return {
    marks,
    lotVersions: lots,
    mapping: { mappingVersion, importerVersion: "importer-syn-v1", destinationsQualified },
  };
}

/** One clean chain: favori superseded by sollicite on the same version. */
export function cleanChainInput(): LotMigrationInput {
  const first = syntheticMark({
    id: "mark-syn-0001",
    statut: "favori",
    supersededBy: "mark-syn-0002",
    createdAt: "2026-01-15T10:00:00.000Z",
  });
  const second = syntheticMark({
    id: "mark-syn-0002",
    statut: "sollicite",
    supersedes: "mark-syn-0001",
    createdAt: "2026-01-16T10:00:00.000Z",
  });
  return syntheticInput([first, second], [syntheticLotVersion()]);
}
