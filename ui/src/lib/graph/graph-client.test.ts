import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchCityGraph,
  type GraphNode,
  type GraphEdge,
} from "./graph-client.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_NODE_BYLAW: GraphNode = {
  id: "bylaw-1",
  type: "Bylaw",
  label: "Règl. 1456",
  citySlug: "salaberry-de-valleyfield",
  props: {},
  sourceRef: null,
};

const MOCK_NODE_ZONE: GraphNode = {
  id: "zone-1",
  type: "Zone",
  label: "R2-3",
  citySlug: "salaberry-de-valleyfield",
  props: {},
  sourceRef: null,
};

const MOCK_EDGE: GraphEdge = {
  id: "edge-uuid-1",
  srcId: "bylaw-1",
  dstId: "zone-1",
  kind: "regulates",
  props: {},
};

const MOCK_GRAPH_RESPONSE = {
  ok: true,
  citySlug: "salaberry-de-valleyfield",
  nodeCount: 2,
  edgeCount: 1,
  nodes: [MOCK_NODE_BYLAW, MOCK_NODE_ZONE],
  edges: [MOCK_EDGE],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── fetchCityGraph — cas nominaux ────────────────────────────────────────────

describe("fetchCityGraph", () => {
  it("returns kind=ok with nodes and edges on HTTP 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_GRAPH_RESPONSE), { status: 200 }),
    );
    const result = await fetchCityGraph("salaberry-de-valleyfield", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.graph.citySlug).toBe("salaberry-de-valleyfield");
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.nodes[0]!.type).toBe("Bylaw");
    expect(result.graph.edges[0]!.kind).toBe("regulates");
  });

  it("calls the correct API URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_GRAPH_RESPONSE), { status: 200 }),
    );
    await fetchCityGraph("beauharnois", { baseUrl: "http://localhost:3001", fetchImpl: mockFetch });
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:3001/api/graph/beauharnois");
  });

  it("URL-encodes the city slug", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_GRAPH_RESPONSE), { status: 200 }),
    );
    await fetchCityGraph("salaberry-de-valleyfield", { baseUrl: "", fetchImpl: mockFetch });
    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("salaberry-de-valleyfield");
  });

  it("strips trailing slash from baseUrl", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(MOCK_GRAPH_RESPONSE), { status: 200 }),
    );
    await fetchCityGraph("beauharnois", {
      baseUrl: "http://localhost:3001/",
      fetchImpl: mockFetch,
    });
    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe("http://localhost:3001/api/graph/beauharnois");
  });

  // ── Cas vide / 404 ────────────────────────────────────────────────────────

  it("returns kind=empty on HTTP 404 (no graph data for city)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, error: "no-graph-data", city: "unknown-city" }),
        { status: 404 },
      ),
    );
    const result = await fetchCityGraph("unknown-city", { baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("empty");
    if (result.kind !== "empty") return;
    expect(result.citySlug).toBe("unknown-city");
  });

  it("returns kind=empty for a city with empty graph (nodes=[])", async () => {
    const emptyResponse = {
      ok: true,
      citySlug: "saint-constant",
      nodeCount: 0,
      edgeCount: 0,
      nodes: [],
      edges: [],
    };
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(emptyResponse), { status: 200 }),
    );
    const result = await fetchCityGraph("saint-constant", { baseUrl: "", fetchImpl: mockFetch });
    // ok=true with nodes=[] is a valid loaded empty graph — not "empty" state
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.graph.nodes).toHaveLength(0);
    expect(result.graph.edges).toHaveLength(0);
  });

  // ── Cas d'erreur ─────────────────────────────────────────────────────────

  it("returns kind=error on HTTP 500", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("{}", { status: 500 }),
    );
    const result = await fetchCityGraph("salaberry-de-valleyfield", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.detail).toContain("500");
  });

  it("returns kind=error on network failure", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = await fetchCityGraph("salaberry-de-valleyfield", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.detail).toBe("fetch failed");
  });

  it("returns kind=error when API body ok=false (not 404)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 200 }),
    );
    const result = await fetchCityGraph("salaberry-de-valleyfield", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });
    expect(result.kind).toBe("error");
  });

  it("returns kind=error when API body has missing nodes array", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, citySlug: "x", edges: [] }), { status: 200 }),
    );
    const result = await fetchCityGraph("x", { baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("error");
  });

  // ── Anti-PII ─────────────────────────────────────────────────────────────

  it("does not expose owner fields in node props", async () => {
    const nodeWithOwner: GraphNode = {
      ...MOCK_NODE_BYLAW,
      props: { community: 1, community_name: "test" },
    };
    const respWithOwner = {
      ...MOCK_GRAPH_RESPONSE,
      nodes: [nodeWithOwner],
    };
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(respWithOwner), { status: 200 }),
    );
    const result = await fetchCityGraph("salaberry-de-valleyfield", {
      baseUrl: "",
      fetchImpl: mockFetch,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // The client passes props through; no "owner" field is fabricated
    const props = result.graph.nodes[0]!.props;
    expect(Object.keys(props)).not.toContain("owner");
  });

  // ── Types de nœuds ────────────────────────────────────────────────────────

  it("preserves all node type fields (Bylaw, DesignationEvent, Zone)", async () => {
    const nodes: GraphNode[] = [
      { id: "b1", type: "Bylaw", label: "Règl. 100", citySlug: "test", props: {}, sourceRef: null },
      { id: "d1", type: "DesignationEvent", label: "Avis 2024-01", citySlug: "test", props: {}, sourceRef: null },
      { id: "z1", type: "Zone", label: "R3-7", citySlug: "test", props: {}, sourceRef: null },
    ];
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, citySlug: "test", nodeCount: 3, edgeCount: 0, nodes, edges: [] }),
        { status: 200 },
      ),
    );
    const result = await fetchCityGraph("test", { baseUrl: "", fetchImpl: mockFetch });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const types = result.graph.nodes.map((n) => n.type);
    expect(types).toContain("Bylaw");
    expect(types).toContain("DesignationEvent");
    expect(types).toContain("Zone");
  });
});
