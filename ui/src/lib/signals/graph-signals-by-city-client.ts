/**
 * Client for GET /api/graph-signals/by-city
 *
 * Returns aggregate Signal + DesignationEvent counts per city from graph_nodes
 * (graphify pipeline, ~197 villes), NOT the old ontology project-state.
 */

import type { VivierV2Counts } from "@radar/domain";

export interface GraphSignalCityItem {
  citySlug: string;
  signalCount: number;
  /**
   * Comptes du vivier v2 (vue B), calculés par le serveur dans la MÊME passe
   * que `subsetCounts` (`aggregateGraphSignalProjectionRows`), sur la même
   * donnée. Invariant : total = qualified + residentialUnknown + Σ exclusions.
   * Absent des réponses d'un serveur antérieur au contrat vivier v2.
   */
  vivierV2Counts?: VivierV2Counts;
  /**
   * Exact intersection counts for each subset of {z, m, p, r} flags.
   * Keys: "", "z", "m", "p", "r", "z|m", … up to "z|m|p|r" (16 keys).
   * Value = nb signals satisfying ALL flags in the key.
   *   z = isZonage  (DesignationEvent always; Signal if category ∈ ZONAGE_CATEGORIES)
   *   m = isMulti4  (nb_unites_max ≥ 4 OR intensite = 'haute')
   *   p = isPrecoce (etape ∈ {avis_motion, projet_reglement})
   *   r = isResidentielPertinent (NOT explicitly non-residential; keeps
   *       residential + indeterminate, drops industriel/commercial/camping/enviro)
   */
  subsetCounts: Record<string, number>;
}

export interface GraphSignalsByCityResponse {
  ok: boolean;
  totalCount: number;
  cities: GraphSignalCityItem[];
}

export async function fetchGraphSignalsByCity(
  baseUrl = "",
): Promise<GraphSignalsByCityResponse> {
  const res = await fetch(`${baseUrl}/api/graph-signals/by-city`);
  if (!res.ok) throw new Error(`graph-signals/by-city: ${res.status}`);
  return res.json();
}
