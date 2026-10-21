/**
 * Per-row diagnosis for the lot-migration report.
 *
 * A row is `unresolved` when its lot version is missing or unqualified; `conflict`
 * for any integrity, convergence, collision, or import-treatment finding;
 * otherwise `mapped`. The `destination-unqualified` diagnostic stays
 * informational: pending 6K inputs never count as a conflict. No branch
 * selects a winner: every head keeps its destination projection.
 */

import { facetFor, priceShapeFor, urlShapeFor } from "./shapes.js";
import { nativeTargetFor, qualifiedTarget } from "./target.js";
import type {
  ManifestDisposition,
  ManifestRow,
  MigrationDiagnosticCode,
} from "./manifest.js";
import type { LotVersionRef, SourceMark } from "./types.js";

export interface DiagnosisContext {
  lotById: Map<string, LotVersionRef>;
  chainId: Map<string, string>;
  cyclic: Set<string>;
  brokenChains: Set<string>;
  crossTargetChains: Set<string>;
  mixedModeChains: Set<string>;
  headGroupCount: Map<string, number>;
  headDestinationKey: Map<string, string>;
  destinationUseCount: Map<string, number>;
  destinationsQualified: boolean;
}

export function diagnoseRow(mark: SourceMark, ctx: DiagnosisContext): ManifestRow {
  const lot = ctx.lotById.get(mark.lotVersionId);
  const root = ctx.chainId.get(mark.id) ?? mark.id;
  const codes = new Set<MigrationDiagnosticCode>();
  if (!qualifiedTarget(lot)) codes.add("target-unresolved");
  if (lot && (lot.noLot !== mark.noLot || lot.citySlug !== mark.citySlug)) {
    codes.add("target-inconsistent");
  }
  if (ctx.brokenChains.has(root)) {
    codes.add("chain-broken");
  }
  if (ctx.cyclic.has(root)) codes.add("chain-cycle");
  if (ctx.crossTargetChains.has(root)) codes.add("chain-cross-target");
  if (ctx.mixedModeChains.has(root)) codes.add("chain-mixed-mode");
  if (mark.supersededBy === null) {
    const group = JSON.stringify([nativeTargetFor(mark, lot), mark.dimension]);
    if ((ctx.headGroupCount.get(group) ?? 0) > 1) {
      codes.add("heads-converged");
    }
    const destinationKey = ctx.headDestinationKey.get(mark.id);
    if (
      destinationKey !== undefined &&
      (ctx.destinationUseCount.get(destinationKey) ?? 0) > 1
    ) {
      codes.add("destination-collision");
    }
  }
  const priceShape = priceShapeFor(mark);
  const urlShape = urlShapeFor(mark);
  if (
    priceShape === "non-canonical" ||
    priceShape === "unexpected-on-pipeline" ||
    urlShape === "non-http-url" ||
    (mark.dimension !== "marche" && mark.lienAnnonce !== null)
  ) {
    codes.add("import-treatment-required");
  }
  if (!ctx.destinationsQualified && lot) {
    codes.add("destination-unqualified");
  }
  const diagnostics = [...codes].sort();
  let disposition: ManifestDisposition = "mapped";
  if (codes.has("target-unresolved")) disposition = "unresolved";
  else if (diagnostics.some((code) => code !== "destination-unqualified")) {
    disposition = "conflict";
  }
  return {
    sourceId: mark.id,
    chainId: root,
    nativeTarget: nativeTargetFor(mark, lot),
    targetQualified: qualifiedTarget(lot),
    disposition,
    diagnostics,
    destination: lot && qualifiedTarget(lot)
      ? {
          facet: facetFor(mark.statut),
          mode: mark.mode,
          canonicalTarget: lot.canonicalId,
          citySlug: lot.citySlug,
        }
      : null,
    observed: {
      dimension: mark.dimension,
      statut: mark.statut,
      mode: mark.mode,
      authorId: mark.authorId,
      prixDemande: mark.prixDemande,
      lienAnnonce: mark.lienAnnonce,
      priceShape,
      urlShape,
      createdAt: mark.createdAt,
      supersedes: mark.supersedes,
      supersededBy: mark.supersededBy,
      denormalizedNoLot: mark.noLot,
      denormalizedCity: mark.citySlug,
      lotVersionId: mark.lotVersionId,
    },
  };
}
