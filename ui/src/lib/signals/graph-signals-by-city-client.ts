/**
 * Client for GET /api/graph-signals/by-city
 *
 * Returns aggregate Signal + DesignationEvent counts per city from graph_nodes
 * (graphify pipeline, ~197 villes), NOT the old ontology project-state.
 */

export interface GraphSignalCityItem {
  citySlug: string;
  signalCount: number;
  /** Breakdown by node type (Signal, DesignationEvent, …). */
  countsByType: Record<string, number>;
  /**
   * Count of zonage signals only.
   * DesignationEvent always counts as zonage; Signal counts only if its
   * category ∈ ZONAGE_CATEGORIES (see api/src/services/graph/graph-store.ts).
   * Used by the « Zonage uniquement » toggle to filter cities top-down.
   */
  zonageCount: number;
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
