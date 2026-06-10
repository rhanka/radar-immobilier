/**
 * Client for GET /api/graph/:city — WP A.3.1 graph read endpoint.
 *
 * Returns the persisted graphify sub-graph for a city:
 * `{ nodes: GraphNode[], edges: GraphEdge[] }`.
 *
 * Anti-PII: node labels come from graphify (zone codes, bylaw refs, etc.) —
 * never owner names. The caller must never render PII. No owner field is
 * present in the API response (the graph-store only persists Bylaw /
 * DesignationEvent / Zone / Lot / Municipality node types from public docs).
 *
 * Error model:
 *   - 404 → { kind: "empty" }  (city has no stored graph)
 *   - network / HTTP ≥ 500 → { kind: "error"; detail }
 *   - ok → { kind: "ok"; nodes; edges }
 */

/** A graph node as returned by GET /api/graph/:city. */
export interface GraphNode {
  id: string;
  type: string;
  label: string;
  citySlug: string | null;
  /** Serialised JSON (community, source_file, …). */
  props: Record<string, unknown>;
  sourceRef: string | null;
}

/** A graph edge as returned by GET /api/graph/:city. */
export interface GraphEdge {
  id: string;
  srcId: string;
  dstId: string;
  kind: string;
  props: Record<string, unknown>;
}

/** The full city sub-graph. */
export interface CityGraph {
  citySlug: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type FetchCityGraphResult =
  | { kind: "ok"; graph: CityGraph }
  | { kind: "empty"; citySlug: string }
  | { kind: "error"; detail: string };

function apiBase(baseUrl: string | undefined): string {
  return baseUrl ? baseUrl.replace(/\/$/, "") : "";
}

/**
 * Fetch the graphify sub-graph for a city slug.
 *
 * - Returns `{ kind: "ok", graph }` when data is present.
 * - Returns `{ kind: "empty" }` when the API answers 404 (no nodes stored).
 * - Returns `{ kind: "error" }` on network failure or HTTP ≥ 500.
 */
export async function fetchCityGraph(
  citySlug: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<FetchCityGraphResult> {
  const base = apiBase(opts.baseUrl);
  const fetchFn = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchFn(`${base}/api/graph/${encodeURIComponent(citySlug)}`);
  } catch (e) {
    return {
      kind: "error",
      detail: e instanceof Error ? e.message : "Connexion impossible",
    };
  }

  if (res.status === 404) {
    return { kind: "empty", citySlug };
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      detail = body.error ?? body.detail ?? detail;
    } catch {
      /* keep status-only detail */
    }
    return { kind: "error", detail };
  }

  const body = (await res.json()) as {
    ok: boolean;
    citySlug: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
  };

  if (!body.ok || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    return {
      kind: "error",
      detail: "Réponse API malformée (ok=false ou nodes/edges manquants)",
    };
  }

  return {
    kind: "ok",
    graph: {
      citySlug: body.citySlug,
      nodes: body.nodes,
      edges: body.edges,
    },
  };
}
