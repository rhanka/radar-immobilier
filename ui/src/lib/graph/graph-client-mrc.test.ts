/**
 * Tests for MRC graph client functions: fetchMrcs() + fetchMrcGraph().
 *
 * Coverage:
 *   1. fetchMrcs — happy path (mrcs list)
 *   2. fetchMrcs — empty list (kind=empty)
 *   3. fetchMrcs — network error
 *   4. fetchMrcs — HTTP 500
 *   5. fetchMrcs — malformed response
 *   6. fetchMrcGraph — happy path (nodes + edges)
 *   7. fetchMrcGraph — 404 → kind=empty
 *   8. fetchMrcGraph — network error
 *   9. fetchMrcGraph — HTTP 500
 *  10. fetchMrcGraph — malformed response (missing nodes)
 *  11. fetchMrcGraph — URL encoding
 *  12. Anti-PII: no owner field in nodes
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchMrcs,
  fetchMrcGraph,
  type MrcSummary,
  type GraphNode,
  type GraphEdge,
} from "./graph-client.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

const MOCK_MRC_LIST: MrcSummary[] = [
  {
    mrc: "Beauharnois-Salaberry",
    nodeCount: 42,
    citySlugs: ["salaberry-de-valleyfield", "beauharnois", "saint-louis"],
  },
  {
    mrc: "Le Haut-Saint-Laurent",
    nodeCount: 18,
    citySlugs: ["huntingdon", "ormstown"],
  },
];

const MOCK_MRCS_RESPONSE = {
  ok: true,
  mrcCount: 2,
  mrcs: MOCK_MRC_LIST,
};

const MOCK_MRC_NODES: GraphNode[] = [
  {
    id: "bylaw-bh-1",
    type: "Bylaw",
    label: "Règl. 1456",
    citySlug: "beauharnois",
    props: {},
    sourceRef: null,
  },
  {
    id: "zone-vf-1",
    type: "Zone",
    label: "R2-3",
    citySlug: "salaberry-de-valleyfield",
    props: {},
    sourceRef: null,
  },
  {
    id: "de-sl-1",
    type: "DesignationEvent",
    label: "Avis 2024-02",
    citySlug: "saint-louis",
    props: {},
    sourceRef: null,
  },
];

const MOCK_MRC_EDGES: GraphEdge[] = [
  {
    id: "edge-1",
    srcId: "bylaw-bh-1",
    dstId: "zone-vf-1",
    kind: "regulates",
    props: {},
  },
  {
    id: "edge-2",
    srcId: "de-sl-1",
    dstId: "zone-vf-1",
    kind: "changes_designation",
    props: {},
  },
];

const MOCK_MRC_GRAPH_RESPONSE = {
  ok: true,
  mrc: "Beauharnois-Salaberry",
  citySlugs: ["salaberry-de-valleyfield", "beauharnois", "saint-louis"],
  nodeCount: 3,
  edgeCount: 2,
  nodes: MOCK_MRC_NODES,
  edges: MOCK_MRC_EDGES,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── fetchMrcs ──────────────────────────────────────────────────────────────────

describe("fetchMrcs", () => {
  it("returns kind=ok with mrcs list on HTTP 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_MRCS_RESPONSE), { status: 200 }),
    );
    const result = await fetchMrcs({ baseUrl: "", fetchImpl: mockFetch });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.mrcCount).toBe(2);
    expect(result.mrcs).toHaveLength(2);
    expect(result.mrcs[0]!.mrc).toBe("Beauharnois-Salaberry");
    expect(result.mrcs[0]!.nodeCount).toBe(42);
    expect(result.mrcs[0]!.citySlugs).toContain("beauharnois");
  });

  it("calls the correct API URL /api/graph/mrcs", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_MRCS_RESPONSE), { status: 200 }),
    );
    await fetchMrcs({ baseUrl: "http://localhost:3001", fetchImpl: mockFetch });
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:3001/api/graph/mrcs");
  });

  it("returns kind=empty when mrcs list is empty", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, mrcCount: 0, mrcs: [] }), { status: 200 }),
    );
    const result = await fetchMrcs({ baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("empty");
  });

  it("returns kind=error on HTTP 500", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("{}", { status: 500 }),
    );
    const result = await fetchMrcs({ baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.detail).toContain("500");
  });

  it("returns kind=error on network failure", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("réseau coupé"));
    const result = await fetchMrcs({ baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.detail).toBe("réseau coupé");
  });

  it("returns kind=error when API body ok=false", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 200 }),
    );
    const result = await fetchMrcs({ baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("error");
  });

  it("returns kind=error when mrcs field is missing", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, mrcCount: 0 }), { status: 200 }),
    );
    const result = await fetchMrcs({ baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("error");
  });
});

// ── fetchMrcGraph ──────────────────────────────────────────────────────────────

describe("fetchMrcGraph", () => {
  it("returns kind=ok with nodes and edges on HTTP 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_MRC_GRAPH_RESPONSE), { status: 200 }),
    );
    const result = await fetchMrcGraph("Beauharnois-Salaberry", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.graph.mrc).toBe("Beauharnois-Salaberry");
    expect(result.graph.nodes).toHaveLength(3);
    expect(result.graph.edges).toHaveLength(2);
    expect(result.graph.citySlugs).toContain("beauharnois");
    expect(result.graph.nodeCount).toBe(3);
    expect(result.graph.edgeCount).toBe(2);
  });

  it("calls the correct API URL /api/graph/mrc/:mrc", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_MRC_GRAPH_RESPONSE), { status: 200 }),
    );
    await fetchMrcGraph("Beauharnois-Salaberry", {
      baseUrl: "http://localhost:3001",
      fetchImpl: mockFetch,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/graph/mrc/Beauharnois-Salaberry",
    );
  });

  it("URL-encodes the MRC name (with spaces/accents)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_MRC_GRAPH_RESPONSE), { status: 200 }),
    );
    await fetchMrcGraph("Le Haut-Saint-Laurent", { baseUrl: "", fetchImpl: mockFetch });
    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("Le%20Haut-Saint-Laurent");
  });

  it("returns kind=empty on HTTP 404", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: "no-mrc-graph", mrc: "unknown-mrc" }),
        { status: 404 },
      ),
    );
    const result = await fetchMrcGraph("unknown-mrc", { baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("empty");
    if (result.kind !== "empty") return;
    expect(result.mrc).toBe("unknown-mrc");
  });

  it("returns kind=error on HTTP 500", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("{}", { status: 500 }),
    );
    const result = await fetchMrcGraph("Beauharnois-Salaberry", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.detail).toContain("500");
  });

  it("returns kind=error on network failure", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("connexion refusée"));
    const result = await fetchMrcGraph("Beauharnois-Salaberry", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.detail).toBe("connexion refusée");
  });

  it("returns kind=error when API body ok=false (non-404)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 200 }),
    );
    const result = await fetchMrcGraph("Beauharnois-Salaberry", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });
    expect(result.kind).toBe("error");
  });

  it("returns kind=error when nodes array is missing", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, mrc: "x", citySlugs: [], nodeCount: 0, edgeCount: 0, edges: [] }),
        { status: 200 },
      ),
    );
    const result = await fetchMrcGraph("x", { baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("error");
  });

  it("returns kind=error when citySlugs is missing", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, mrc: "x", nodeCount: 0, edgeCount: 0, nodes: [], edges: [] }),
        { status: 200 },
      ),
    );
    const result = await fetchMrcGraph("x", { baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("error");
  });

  it("accepts a graph with 0 nodes (kind=ok, empty nodes/edges)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          mrc: "Vide-MRC",
          citySlugs: ["ville-a"],
          nodeCount: 0,
          edgeCount: 0,
          nodes: [],
          edges: [],
        }),
        { status: 200 },
      ),
    );
    const result = await fetchMrcGraph("Vide-MRC", { baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.graph.nodes).toHaveLength(0);
    expect(result.graph.edges).toHaveLength(0);
    expect(result.graph.citySlugs).toContain("ville-a");
  });
});

// ── Anti-PII ──────────────────────────────────────────────────────────────────

describe("fetchMrcGraph — anti-PII", () => {
  it("aucun nœud ne contient de champ owner dans les props", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_MRC_GRAPH_RESPONSE), { status: 200 }),
    );
    const result = await fetchMrcGraph("Beauharnois-Salaberry", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    for (const node of result.graph.nodes) {
      expect(Object.keys(node.props)).not.toContain("owner");
      expect(Object.keys(node.props)).not.toContain("proprietaire");
    }
  });

  it("les nœuds multi-villes gardent leur citySlug public (code de municipalité)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_MRC_GRAPH_RESPONSE), { status: 200 }),
    );
    const result = await fetchMrcGraph("Beauharnois-Salaberry", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // citySlug est un identifiant public de municipalité, pas un nom de propriétaire
    for (const node of result.graph.nodes) {
      if (node.citySlug) {
        expect(node.citySlug).not.toMatch(/^[A-Z][a-z]+ [A-Z][A-Z]+$/);
      }
    }
  });
});

// ── Rendu du graphe MRC (helpers) ─────────────────────────────────────────────

/** Port des helpers de positionnement (identiques à CityGraphView / MrcGraphView). */
const TYPE_ORDER = [
  "Lot", "Valuation", "Zone", "Bylaw", "DesignationEvent",
  "Adresse", "Constraint", "Source", "Signal", "Municipality", "concept",
];
const ROW_HEIGHT = 90;
const COL_WIDTH = 110;
const TOP_MARGIN = 50;
const LEFT_MARGIN = 60;

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

function positionNodes(nodes: GraphNode[]): PositionedNode[] {
  const byType = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const arr = byType.get(n.type) ?? [];
    arr.push(n);
    byType.set(n.type, arr);
  }
  const presentTypes = TYPE_ORDER.filter((t) => byType.has(t));
  for (const t of byType.keys()) {
    if (!presentTypes.includes(t)) presentTypes.push(t);
  }
  const positioned: PositionedNode[] = [];
  let row = 0;
  for (const type of presentTypes) {
    const group = byType.get(type) ?? [];
    const y = TOP_MARGIN + row * ROW_HEIGHT;
    for (let col = 0; col < group.length; col++) {
      const x = LEFT_MARGIN + col * COL_WIDTH + COL_WIDTH / 2;
      positioned.push({ ...group[col]!, x, y });
    }
    row++;
  }
  return positioned;
}

describe("MrcGraphView — positionnement des nœuds multi-villes", () => {
  it("positionne les nœuds de différentes villes ensemble par type", () => {
    const positioned = positionNodes(MOCK_MRC_NODES);
    // Bylaw (beauharnois) et Zone (valleyfield) sur des rangées différentes
    const bylawNode = positioned.find((n) => n.type === "Bylaw");
    const zoneNode = positioned.find((n) => n.type === "Zone");
    expect(bylawNode).toBeDefined();
    expect(zoneNode).toBeDefined();
    expect(bylawNode!.y).not.toBe(zoneNode!.y);
  });

  it("groupe les nœuds de même type quelle que soit la ville d'origine", () => {
    // Ajouter un second nœud Bylaw d'une autre ville
    const nodes: GraphNode[] = [
      ...MOCK_MRC_NODES,
      {
        id: "bylaw-vf-1",
        type: "Bylaw",
        label: "Règl. 800",
        citySlug: "salaberry-de-valleyfield",
        props: {},
        sourceRef: null,
      },
    ];
    const positioned = positionNodes(nodes);
    const bylawNodes = positioned.filter((n) => n.type === "Bylaw");
    expect(bylawNodes).toHaveLength(2);
    // Même rangée
    expect(new Set(bylawNodes.map((n) => n.y))).toHaveProperty("size", 1);
    // Colonnes différentes
    expect(bylawNodes[0]!.x).not.toBe(bylawNodes[1]!.x);
  });

  it("retourne un tableau vide pour un graphe MRC vide", () => {
    expect(positionNodes([])).toHaveLength(0);
  });

  it("tous les nœuds ont des coordonnées finies et positives", () => {
    const positioned = positionNodes(MOCK_MRC_NODES);
    for (const n of positioned) {
      expect(isFinite(n.x)).toBe(true);
      expect(isFinite(n.y)).toBe(true);
      expect(n.x).toBeGreaterThan(0);
      expect(n.y).toBeGreaterThan(0);
    }
  });
});

describe("MrcGraphView — helpers d'affichage", () => {
  function shortLabel(label: string): string {
    return label.length > 14 ? label.slice(0, 12) + "…" : label;
  }
  function edgeLabel(kind: string): string {
    return kind.length > 18 ? kind.slice(0, 16) + "…" : kind;
  }

  it("shortLabel tronque les libellés longs", () => {
    expect(shortLabel("Règlement municipal 1456")).toBe("Règlement mu…");
  });
  it("shortLabel préserve les libellés courts", () => {
    expect(shortLabel("R2-3")).toBe("R2-3");
  });
  it("edgeLabel tronque les relations longues", () => {
    expect(edgeLabel("changes_designation_in_zone")).toBe("changes_designat…");
  });
  it("edgeLabel préserve les relations courtes", () => {
    expect(edgeLabel("regulates")).toBe("regulates");
  });
});
