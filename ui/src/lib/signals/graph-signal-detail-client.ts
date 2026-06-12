/**
 * Client for GET /api/graph-signals/:city
 *
 * Fetches Signal + DesignationEvent nodes for one city from graph_nodes
 * (graphify pipeline, ~197 villes), NOT the old ontology project-state.
 *
 * Anti-invention: returns 404 when no signal nodes exist for the city.
 */

export interface GraphSignalNode {
  id: string;
  type: "Signal" | "DesignationEvent" | string;
  label: string;
  citySlug: string | null;
  sourceRef: string | null;
  createdAt: string | null;
  props: Record<string, unknown>;
}

export interface GraphSignalDetailResponse {
  ok: boolean;
  citySlug: string;
  nodes: GraphSignalNode[];
}

export async function fetchGraphSignalDetail(
  citySlug: string,
  baseUrl = "",
): Promise<GraphSignalDetailResponse> {
  const res = await fetch(
    `${baseUrl}/api/graph-signals/${encodeURIComponent(citySlug)}`,
  );
  if (!res.ok) throw new Error(`graph-signals/${citySlug}: ${res.status}`);
  return res.json();
}
