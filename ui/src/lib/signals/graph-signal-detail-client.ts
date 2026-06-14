/**
 * Client for GET /api/graph-signals/:city
 *
 * Fetches Signal + DesignationEvent nodes for one city from graph_nodes
 * (graphify pipeline, ~197 villes), NOT the old ontology project-state.
 *
 * Anti-invention: returns 404 when no signal nodes exist for the city.
 */

/**
 * A documentary reference attached to a Signal or DesignationEvent node.
 *
 * Mirrors the graphify v2 `refs` array items stored in graph_nodes.props.refs.
 *   - docSha     : SHA-256 hex of the source document (always present)
 *   - excerpt    : short citation extracted from the document (optional)
 *   - page       : 1-based page number in the PDF (optional)
 *   - sourceUrl  : public URL of the original PDF/page (optional, preferred for link)
 *   - rawRef     : SCW-internal path (optional, fallback identifier)
 */
export interface SignalDocRef {
  docSha: string;
  excerpt?: string;
  page?: number;
  sourceUrl?: string;
  rawRef?: string;
}

/**
 * Extract typed SignalDocRef[] from a node's raw props.refs (unknown[]).
 * Returns [] when props.refs is absent, not an array, or items lack docSha.
 */
export function extractDocRefs(props: Record<string, unknown>): SignalDocRef[] {
  const raw = props["refs"];
  if (!Array.isArray(raw)) return [];
  const result: SignalDocRef[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r["docSha"] !== "string") continue;
    result.push({
      docSha: r["docSha"] as string,
      excerpt: typeof r["excerpt"] === "string" ? r["excerpt"] : undefined,
      page: typeof r["page"] === "number" ? r["page"] : undefined,
      sourceUrl: typeof r["sourceUrl"] === "string" ? r["sourceUrl"] : undefined,
      rawRef: typeof r["rawRef"] === "string" ? r["rawRef"] : undefined,
    });
  }
  return result;
}

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
