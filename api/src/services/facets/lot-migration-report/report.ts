/**
 * Lossless lot-migration report builder (6F, report only).
 *
 * Pure function of the source snapshot plus the mapping configuration:
 * no I/O, no logging, no mutation of its inputs. Every source row yields
 * exactly one manifest row; rows that cannot be projected carry explicit
 * diagnostics instead of being dropped or auto-resolved.
 */

import { buildChains, findBrokenChains, findCyclicRows } from "./chains.js";
import { diagnoseRow } from "./diagnose.js";
import type { DiagnosisContext } from "./diagnose.js";
import { canonicalJson, compareText, sha256Hex } from "./digest.js";
import { facetFor } from "./shapes.js";
import { nativeTargetFor, qualifiedTarget } from "./target.js";
import { LOT_MIGRATION_REPORT_VERSION } from "./types.js";
import type { LotMigrationReport } from "./manifest.js";
import type { LotMigrationInput, SourceMark } from "./types.js";

export function buildLotMigrationReport(
  input: LotMigrationInput,
): LotMigrationReport {
  const marks = [...input.marks].sort((a, b) => compareText(a.id, b.id));
  const lotVersions = [...input.lotVersions].sort((a, b) =>
    compareText(a.id, b.id),
  );
  const byId = new Map(marks.map((mark) => [mark.id, mark]));
  const lotById = new Map(lotVersions.map((lot) => [lot.id, lot]));
  if (byId.size !== marks.length || lotById.size !== lotVersions.length) {
    throw new Error("Migration snapshot contains duplicate source IDs");
  }
  const chainId = buildChains(marks);

  const membersByChain = new Map<string, string[]>();
  for (const mark of marks) {
    const root = chainId.get(mark.id) ?? mark.id;
    membersByChain.set(root, [...(membersByChain.get(root) ?? []), mark.id]);
  }
  const memberOf = (root: string): string[] => membersByChain.get(root) ?? [];
  const crossTargetChains = new Set<string>();
  const mixedModeChains = new Set<string>();
  for (const root of membersByChain.keys()) {
    const members = memberOf(root).map((id) => byId.get(id)).filter(
      (mark): mark is SourceMark => mark !== undefined,
    );
    if (new Set(members.map((mark) => mark.lotVersionId)).size > 1) {
      crossTargetChains.add(root);
    }
    if (new Set(members.map((mark) => mark.mode)).size > 1) {
      mixedModeChains.add(root);
    }
  }

  const heads = marks.filter((mark) => mark.supersededBy === null);
  const headGroupCount = new Map<string, number>();
  const headDestinationKey = new Map<string, string>();
  const destinationUseCount = new Map<string, number>();
  for (const head of heads) {
    const lot = lotById.get(head.lotVersionId);
    const group = JSON.stringify([nativeTargetFor(head, lot), head.dimension]);
    headGroupCount.set(group, (headGroupCount.get(group) ?? 0) + 1);
    if (!lot || !qualifiedTarget(lot)) continue;
    const key = JSON.stringify([lot.citySlug, lot.canonicalId, facetFor(head.statut), head.mode]);
    headDestinationKey.set(head.id, key);
    destinationUseCount.set(key, (destinationUseCount.get(key) ?? 0) + 1);
  }

  const ctx: DiagnosisContext = {
    lotById,
    chainId,
    cyclic: new Set([...findCyclicRows(byId)].map((id) => chainId.get(id) ?? id)),
    brokenChains: findBrokenChains(byId, chainId),
    crossTargetChains,
    mixedModeChains,
    headGroupCount,
    headDestinationKey,
    destinationUseCount,
    destinationsQualified: input.mapping.destinationsQualified,
  };
  const rows = marks.map((mark) => diagnoseRow(mark, ctx));

  const counts = {
    sourceEvents: marks.length,
    chains: membersByChain.size,
    nativeTargets: new Set(rows.map((row) => row.nativeTarget)).size,
    sourceHeads: heads.length,
    projectedHeads: rows.filter(
      (row, index) =>
        marks[index]?.supersededBy === null && row.destination !== null,
    ).length,
    conflicts: rows.filter((row) => row.disposition !== "mapped").length,
  };

  const sourceSnapshotId = sha256Hex(
    canonicalJson({ lots: lotVersions, marks }),
  );
  const manifestSha256 = sha256Hex(
    canonicalJson({
      mapping: input.mapping,
      reportVersion: LOT_MIGRATION_REPORT_VERSION,
      rows,
      sourceSnapshotId,
    }),
  );

  return {
    reportVersion: LOT_MIGRATION_REPORT_VERSION,
    mappingVersion: input.mapping.mappingVersion,
    importerVersion: input.mapping.importerVersion,
    sourceSnapshotId,
    manifestSha256,
    destinationsQualified: input.mapping.destinationsQualified,
    counts,
    rows,
  };
}
