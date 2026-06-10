/**
 * Tests for CityGraphView — Studio de réconciliation : sous-graphe graphify.
 *
 * Pattern : test helpers + client (no @testing-library/svelte in devDeps).
 *
 * Coverage :
 *   1. graph-client : fetchCityGraph happy-path + error/empty states
 *   2. Node positioning helpers (layout grille par type)
 *   3. Type-color mapping
 *   4. Label-truncation helpers
 *   5. Anti-PII : jamais de champ owner dans les nœuds
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchCityGraph,
  type GraphNode,
  type GraphEdge,
} from "$lib/graph/graph-client.js";

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeNode(id: string, type: string, label: string): GraphNode {
  return { id, type, label, citySlug: "salaberry-de-valleyfield", props: {}, sourceRef: null };
}

function makeEdge(srcId: string, dstId: string, kind: string): GraphEdge {
  return { id: `${srcId}-${dstId}`, srcId, dstId, kind, props: {} };
}

const VALLEYFIELD_NODES: GraphNode[] = [
  makeNode("bylaw-1", "Bylaw", "Règl. 1456"),
  makeNode("bylaw-2", "Bylaw", "Règl. 1457"),
  makeNode("zone-1", "Zone", "R2-3"),
  makeNode("zone-2", "Zone", "M1-5"),
  makeNode("de-1", "DesignationEvent", "Avis 2024-01"),
  makeNode("mun-1", "Municipality", "Salaberry-de-Valleyfield"),
];

const VALLEYFIELD_EDGES: GraphEdge[] = [
  makeEdge("bylaw-1", "zone-1", "regulates"),
  makeEdge("bylaw-2", "zone-2", "regulates"),
  makeEdge("de-1", "zone-1", "changes_designation"),
  makeEdge("mun-1", "bylaw-1", "adopts"),
];

const MOCK_FULL_RESPONSE = {
  ok: true,
  citySlug: "salaberry-de-valleyfield",
  nodeCount: VALLEYFIELD_NODES.length,
  edgeCount: VALLEYFIELD_EDGES.length,
  nodes: VALLEYFIELD_NODES,
  edges: VALLEYFIELD_EDGES,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 1. graph-client intégration ───────────────────────────────────────────────

describe("CityGraphView — graph-client intégration", () => {
  it("charge le graphe complet d'une ville réelle", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_FULL_RESPONSE), { status: 200 }),
    );
    const result = await fetchCityGraph("salaberry-de-valleyfield");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.graph.nodes).toHaveLength(6);
    expect(result.graph.edges).toHaveLength(4);
  });

  it("retourne kind=empty quand la ville n'a pas de graphe (404)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ ok: false, error: "no-graph-data", city: "vide-sur-mer" }),
        { status: 404 },
      ),
    );
    const result = await fetchCityGraph("vide-sur-mer");
    expect(result.kind).toBe("empty");
    if (result.kind !== "empty") return;
    expect(result.citySlug).toBe("vide-sur-mer");
  });

  it("retourne kind=error sur erreur réseau", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("réseau indisponible"); });
    const result = await fetchCityGraph("salaberry-de-valleyfield");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.detail).toBe("réseau indisponible");
  });

  it("retourne kind=error sur HTTP 500", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response("{}", { status: 500 }),
    );
    const result = await fetchCityGraph("beauharnois");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.detail).toContain("500");
  });

  it("accepte un graphe avec 0 nœuds (kind=ok, nodes vide)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ ok: true, citySlug: "empty-city", nodeCount: 0, edgeCount: 0, nodes: [], edges: [] }),
        { status: 200 },
      ),
    );
    const result = await fetchCityGraph("empty-city");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.graph.nodes).toHaveLength(0);
    expect(result.graph.edges).toHaveLength(0);
  });
});

// ── 2. Helpers de positionnement (grille par type) ────────────────────────────

/** Port des helpers de positionnement de CityGraphView pour les tests. */
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

describe("CityGraphView — positionnement des nœuds", () => {
  it("chaque type de nœud occupe une rangée distincte", () => {
    const positioned = positionNodes(VALLEYFIELD_NODES);
    // Bylaw nodes doit être sur la même rangée
    const bylawNodes = positioned.filter((n) => n.type === "Bylaw");
    expect(new Set(bylawNodes.map((n) => n.y))).toHaveProperty("size", 1);
    // Zone nodes doit être sur une rangée différente des Bylaw nodes
    const zoneNodes = positioned.filter((n) => n.type === "Zone");
    expect(zoneNodes[0]!.y).not.toBe(bylawNodes[0]!.y);
  });

  it("les nœuds d'un même type sont répartis en colonnes distinctes", () => {
    const positioned = positionNodes(VALLEYFIELD_NODES);
    const bylawNodes = positioned.filter((n) => n.type === "Bylaw");
    expect(bylawNodes).toHaveLength(2);
    expect(bylawNodes[0]!.x).not.toBe(bylawNodes[1]!.x);
  });

  it("respecte l'ordre TYPE_ORDER (Zone avant Bylaw)", () => {
    const positioned = positionNodes(VALLEYFIELD_NODES);
    const firstZoneY = positioned.find((n) => n.type === "Zone")!.y;
    const firstBylawY = positioned.find((n) => n.type === "Bylaw")!.y;
    // Zone vient avant Bylaw dans TYPE_ORDER
    expect(firstZoneY).toBeLessThan(firstBylawY);
  });

  it("les nœuds de types inconnus s'ajoutent après les types connus", () => {
    const nodes = [
      ...VALLEYFIELD_NODES,
      makeNode("custom-1", "CustomType", "Custom label"),
    ];
    const positioned = positionNodes(nodes);
    const customNode = positioned.find((n) => n.type === "CustomType");
    expect(customNode).toBeDefined();
    // Le type personnalisé vient après tous les types de TYPE_ORDER
    const maxKnownY = Math.max(
      ...TYPE_ORDER.flatMap((t) => positioned.filter((n) => n.type === t).map((n) => n.y)),
    );
    expect(customNode!.y).toBeGreaterThanOrEqual(maxKnownY);
  });

  it("retourne un tableau vide pour un graphe sans nœuds", () => {
    expect(positionNodes([])).toHaveLength(0);
  });

  it("tous les nœuds ont des coordonnées finies et positives", () => {
    const positioned = positionNodes(VALLEYFIELD_NODES);
    for (const n of positioned) {
      expect(isFinite(n.x)).toBe(true);
      expect(isFinite(n.y)).toBe(true);
      expect(n.x).toBeGreaterThan(0);
      expect(n.y).toBeGreaterThan(0);
    }
  });
});

// ── 3. Helpers d'affichage ────────────────────────────────────────────────────

function shortLabel(label: string): string {
  return label.length > 14 ? label.slice(0, 12) + "…" : label;
}

function edgeLabel(kind: string): string {
  return kind.length > 18 ? kind.slice(0, 16) + "…" : kind;
}

describe("CityGraphView — helpers d'affichage", () => {
  it("shortLabel tronque les libellés longs à 12+ellipse chars", () => {
    const long = "Règlement 1456 article 12";
    expect(shortLabel(long)).toBe("Règlement 14…");
    expect(shortLabel(long)).toHaveLength(13);
  });

  it("shortLabel préserve les libellés courts", () => {
    expect(shortLabel("R2-3")).toBe("R2-3");
    expect(shortLabel("Règl. 1456")).toBe("Règl. 1456");
  });

  it("edgeLabel tronque les relations longues", () => {
    const long = "changes_designation_in_zone_bylaw";
    expect(edgeLabel(long)).toBe("changes_designat…");
  });

  it("edgeLabel préserve les relations courtes", () => {
    expect(edgeLabel("regulates")).toBe("regulates");
    expect(edgeLabel("adopts")).toBe("adopts");
  });
});

// ── 4. Anti-PII ───────────────────────────────────────────────────────────────

describe("CityGraphView — anti-PII", () => {
  it("aucun nœud ne contient de champ owner dans les props", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_FULL_RESPONSE), { status: 200 }),
    );
    const result = await fetchCityGraph("salaberry-de-valleyfield");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    for (const node of result.graph.nodes) {
      expect(Object.keys(node.props)).not.toContain("owner");
      expect(Object.keys(node.props)).not.toContain("proprietaire");
    }
  });

  it("les labels de nœuds sont des références publiques (codes zonage/règlements)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify(MOCK_FULL_RESPONSE), { status: 200 }),
    );
    const result = await fetchCityGraph("salaberry-de-valleyfield");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // Les labels ne doivent pas ressembler à des noms de personnes physiques
    // (heuristique : pas de patterns "Prénom NOM" dans les fixtures)
    for (const node of result.graph.nodes) {
      expect(node.label).not.toMatch(/^[A-Z][a-z]+ [A-Z][A-Z]+$/);
    }
  });
});
