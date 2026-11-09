/**
 * Filtre dropdown counts (owner 2026-11-09): how many signals match each
 * Filtre axis — or are excluded by each exclusion — within the current
 * scope. Pure, no I/O: the caller scopes the nodes (period + Pertinence)
 * from the already-loaded city detail; this only reads the server
 * classification carried by each node, never reclassifies.
 *
 * The B universe is the server-qualified perimeter: a node with
 * `exclusion_reason !== null` is outside B for every axis combination
 * (parity with `projectComposedVivierB`), so it is not counted here.
 * A node without a usable classification makes the whole count `null`
 * (no partial count is ever shown as exact).
 */
import { isHiddenByVivierBExclusions, isResidentialEligible } from "@radar/domain";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";

export interface FiltreCounts {
  /** Zonage: zonage `oui`. */
  z: number;
  /** Résidentiel: residential eligibility (shared server predicate). */
  r: number;
  /** Précoce: early stage (avis_motion / projet_reglement). */
  p: number;
  /** Signals excluded by « Exclure PIIA sans projet résidentiel ». */
  piia: number;
  /** Signals excluded by « Exclure dérogations mineures ». */
  derog: number;
}

const PRECOCE_ETAPES = new Set(["avis_motion", "projet_reglement"]);

export function filtreCountsFor(nodes: readonly GraphSignalNode[]): FiltreCounts | null {
  const counts: FiltreCounts = { z: 0, r: 0, p: 0, piia: 0, derog: 0 };
  for (const node of nodes) {
    const classification = node.classification;
    if (!classification) return null;
    if (classification.exclusion_reason !== null) continue;
    if (classification.zonage.valeur === "oui") counts.z += 1;
    if (isResidentialEligible(classification)) counts.r += 1;
    if (PRECOCE_ETAPES.has(classification.etape)) counts.p += 1;
    if (isHiddenByVivierBExclusions(node, { piiaSansProjetResidentiel: true, derogationsMineures: false })) counts.piia += 1;
    if (isHiddenByVivierBExclusions(node, { piiaSansProjetResidentiel: false, derogationsMineures: true })) counts.derog += 1;
  }
  return counts;
}

/** Tooltip / note text: counts cover the selected city's loaded detail only. */
export const FILTER_COUNTS_SCOPE_NOTE =
  "Comptes de la ville sélectionnée (détail chargé) — les autres villes ne sont pas comptées, leur détail n'est pas chargé.";
