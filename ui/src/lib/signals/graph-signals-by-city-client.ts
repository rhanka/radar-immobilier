/**
 * Client for GET /api/graph-signals/by-city
 *
 * Returns aggregate Signal + DesignationEvent counts per city from graph_nodes
 * (graphify pipeline, ~197 villes), NOT the old ontology project-state.
 */

export interface GraphSignalCityItem {
  citySlug: string;
  signalCount: number;
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
