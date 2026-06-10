/**
 * Client for graph API endpoints (city + MRC aggregates).
 *
 * Endpoints:
 *   GET /api/graph/:city        → city sub-graph
 *   GET /api/graph/mrcs         → list of MRCs with node counts
 *   GET /api/graph/mrc/:mrc     → MRC aggregate sub-graph
 *
 * Anti-PII: node labels come from graphify (zone codes, bylaw refs, etc.) —
 * never owner names. The caller must never render PII. No owner field is
 * present in the API response (the graph-store only persists Bylaw /
 * DesignationEvent / Zone / Lot / Municipality node types from public docs).
 *
 * Error model:
 *   - 404 → { kind: "empty" }  (no stored graph)
 *   - network / HTTP ≥ 500 → { kind: "error"; detail }
 *   - ok → { kind: "ok"; … }
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

// ── MRC types ──────────────────────────────────────────────────────────────

/**
 * Summary entry for a single MRC (from GET /api/graph/mrcs).
 *
 * Anti-PII: mrc is a public administrative zone name; citySlugs are
 * municipality identifiers from public registry — no personal data.
 */
export interface MrcSummary {
  mrc: string;
  nodeCount: number;
  citySlugs: string[];
}

/** Result of fetchMrcs(). */
export type FetchMrcsResult =
  | { kind: "ok"; mrcs: MrcSummary[]; mrcCount: number }
  | { kind: "empty" }
  | { kind: "error"; detail: string };

/** The full MRC aggregate sub-graph. */
export interface MrcGraph {
  mrc: string;
  citySlugs: string[];
  nodeCount: number;
  edgeCount: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Result of fetchMrcGraph(). */
export type FetchMrcGraphResult =
  | { kind: "ok"; graph: MrcGraph }
  | { kind: "empty"; mrc: string }
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

/**
 * Fetch the list of MRCs with stored graphs.
 *
 * GET /api/graph/mrcs → { ok, mrcCount, mrcs: [{ mrc, nodeCount, citySlugs }] }
 *
 * - Returns `{ kind: "ok", mrcs, mrcCount }` when at least one MRC is present.
 * - Returns `{ kind: "empty" }` when the list is empty (0 MRCs indexed).
 * - Returns `{ kind: "error" }` on network failure or HTTP ≥ 500.
 */
export async function fetchMrcs(
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<FetchMrcsResult> {
  const base = apiBase(opts.baseUrl);
  const fetchFn = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchFn(`${base}/api/graph/mrcs`);
  } catch (e) {
    return {
      kind: "error",
      detail: e instanceof Error ? e.message : "Connexion impossible",
    };
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
    mrcCount: number;
    mrcs: MrcSummary[];
  };

  if (!body.ok || !Array.isArray(body.mrcs)) {
    return {
      kind: "error",
      detail: "Réponse API malformée (ok=false ou mrcs manquant)",
    };
  }

  if (body.mrcs.length === 0) {
    return { kind: "empty" };
  }

  return { kind: "ok", mrcs: body.mrcs, mrcCount: body.mrcCount };
}

/**
 * Fetch the graphify aggregate sub-graph for a MRC.
 *
 * GET /api/graph/mrc/:mrc → { ok, mrc, citySlugs, nodeCount, edgeCount, nodes, edges }
 *
 * - Returns `{ kind: "ok", graph }` when data is present.
 * - Returns `{ kind: "empty" }` when the API answers 404 (no graph for MRC).
 * - Returns `{ kind: "error" }` on network failure or HTTP ≥ 500.
 */
export async function fetchMrcGraph(
  mrc: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<FetchMrcGraphResult> {
  const base = apiBase(opts.baseUrl);
  const fetchFn = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchFn(`${base}/api/graph/mrc/${encodeURIComponent(mrc)}`);
  } catch (e) {
    return {
      kind: "error",
      detail: e instanceof Error ? e.message : "Connexion impossible",
    };
  }

  if (res.status === 404) {
    return { kind: "empty", mrc };
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
    mrc: string;
    citySlugs: string[];
    nodeCount: number;
    edgeCount: number;
    nodes: GraphNode[];
    edges: GraphEdge[];
  };

  if (
    !body.ok ||
    !Array.isArray(body.nodes) ||
    !Array.isArray(body.edges) ||
    !Array.isArray(body.citySlugs)
  ) {
    return {
      kind: "error",
      detail: "Réponse API malformée (ok=false ou nodes/edges/citySlugs manquants)",
    };
  }

  return {
    kind: "ok",
    graph: {
      mrc: body.mrc,
      citySlugs: body.citySlugs,
      nodeCount: body.nodeCount,
      edgeCount: body.edgeCount,
      nodes: body.nodes,
      edges: body.edges,
    },
  };
}
