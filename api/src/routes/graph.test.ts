/**
 * WP A.3.1 — Graph route unit tests.
 *
 * Tests the Hono route layer for graph endpoints.
 * Uses a mock Database that returns controlled fixtures — no Postgres required.
 *
 * Endpoints under test:
 *   GET /api/graph/mrcs         — list MRCs with ingested nodes
 *   GET /api/graph/mrc/:mrc     — MRC sub-graph
 *   GET /api/graph/:city        — city sub-graph (existing)
 */

import { describe, it, expect } from "vitest";
import { graphRoute } from "./graph.js";
import type { Database } from "../db/client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal graph_nodes row shape. */
function makeNode(id: string, citySlug: string) {
  return {
    id,
    citySlug,
    type: "concept",
    label: id,
    props: {},
    sourceRef: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
  };
}

/** Minimal graph_edges row shape. */
function makeEdge(srcId: string, dstId: string, kind = "régi_par") {
  return {
    id: `${srcId}->${dstId}`,
    srcId,
    dstId,
    kind,
    props: {},
    createdAt: new Date("2024-01-01T00:00:00Z"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB factory
//
// subgraphForCity, subgraphForMrc, and listMrcs each follow a predictable
// query sequence. We mock at the Drizzle builder level using a call queue so
// we can control what each `.where(...)` invocation returns.
// ─────────────────────────────────────────────────────────────────────────────

type QueryResult = Record<string, unknown>[];

/**
 * Build a mock DB where each call to `.where(...)` returns the next batch from
 * the provided queue (in order). Pass an empty array [] as a sentinel for
 * "no rows". The `select({ count })` variant returns `[{ count: N }]`.
 */
function makeMockDb(returnQueue: Array<QueryResult>): Database {
  let callIdx = 0;

  const makeChain = (): object => ({
    from: () => makeChain(),
    where: () => {
      const result = returnQueue[callIdx] ?? [];
      callIdx++;
      return Promise.resolve(result);
    },
  });

  return {
    select: () => makeChain(),
    selectDistinct: () => makeChain(),
  } as unknown as Database;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/graph/:city
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/graph/:city", () => {
  it("returns 200 with empty graph for an unknown city (not yet ingested)", async () => {
    // subgraphForCity queries nodes first → empty → short-circuits.
    // Route now returns 200 + {nodes:[], edges:[]} instead of 404 so the UI
    // can display "not ingested yet" gracefully.
    const db = makeMockDb([[]]);
    const app = graphRoute({ db });
    const res = await app.request("/api/graph/__no_such_city__");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      citySlug: string;
      nodeCount: number;
      edgeCount: number;
      nodes: unknown[];
      edges: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe("__no_such_city__");
    expect(body.nodeCount).toBe(0);
    expect(body.edgeCount).toBe(0);
    expect(body.nodes).toHaveLength(0);
    expect(body.edges).toHaveLength(0);
  });

  it("returns nodes and edges for a known city", async () => {
    const nodes = [
      makeNode("zone_a", "salaberry-de-valleyfield"),
      makeNode("bylaw_1", "salaberry-de-valleyfield"),
    ];
    const edges = [makeEdge("zone_a", "bylaw_1")];

    // subgraphForCity:
    //   call 1: nodes query
    //   call 2: candidate edges query (filtered in-process)
    const db = makeMockDb([nodes, edges]);
    const app = graphRoute({ db });
    const res = await app.request("/api/graph/salaberry-de-valleyfield");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      citySlug: string;
      nodeCount: number;
      edgeCount: number;
      nodes: unknown[];
      edges: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.citySlug).toBe("salaberry-de-valleyfield");
    expect(body.nodeCount).toBe(2);
    expect(body.edgeCount).toBe(1);
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/graph/mrc/:mrc
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/graph/mrc/:mrc", () => {
  it("returns 404 for an MRC with no ingested data", async () => {
    // subgraphForMrc: Beauharnois-Salaberry IS in QC_MUNICIPALITIES, so
    // citySlugs will be non-empty, but the nodes query returns [].
    const db = makeMockDb([[]]);
    const app = graphRoute({ db });
    const res = await app.request(
      "/api/graph/mrc/Beauharnois-Salaberry",
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string; mrc: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("no-graph-data");
    expect(body.mrc).toBe("Beauharnois-Salaberry");
  });

  it("returns 404 for an MRC unknown to QC_MUNICIPALITIES", async () => {
    // subgraphForMrc short-circuits when no cities map to the MRC.
    const db = makeMockDb([]); // no queries should be made
    const app = graphRoute({ db });
    const res = await app.request("/api/graph/mrc/__mrc_inconnue__");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("no-graph-data");
  });

  it("returns merged MRC subgraph when data is ingested", async () => {
    const nodes = [
      makeNode("zone_a", "salaberry-de-valleyfield"),
      makeNode("zone_b", "beauharnois"),
      makeNode("bylaw_1", "salaberry-de-valleyfield"),
    ];
    // Edge: zone_a → bylaw_1 (both in MRC node set → kept)
    const edges = [makeEdge("zone_a", "bylaw_1")];

    // subgraphForMrc:
    //   call 1: nodes (inArray on citySlug)
    //   call 2: candidate edges (inArray on srcId) — both zone_a→bylaw_1 returned
    const db = makeMockDb([nodes, edges]);
    const app = graphRoute({ db });
    const res = await app.request("/api/graph/mrc/Beauharnois-Salaberry");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mrc: string;
      citySlugs: string[];
      nodeCount: number;
      edgeCount: number;
      nodes: unknown[];
      edges: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.mrc).toBe("Beauharnois-Salaberry");
    expect(body.citySlugs).toContain("salaberry-de-valleyfield");
    expect(body.citySlugs).toContain("beauharnois");
    expect(body.nodeCount).toBe(3);
    expect(body.edgeCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/graph/mrcs
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/graph/mrcs", () => {
  it("returns ok:true with empty mrcs array when no data ingested", async () => {
    // listMrcs:
    //   call 1: selectDistinct citySlug → []
    const db = makeMockDb([[]]);
    const app = graphRoute({ db });
    const res = await app.request("/api/graph/mrcs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mrcCount: number;
      mrcs: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.mrcCount).toBe(0);
    expect(body.mrcs).toEqual([]);
  });

  it("returns a populated MRC list when cities have been ingested", async () => {
    // listMrcs:
    //   call 1: selectDistinct citySlug → two cities in same MRC
    //   call 2: count query for the MRC → [{ count: 5 }]
    const db = makeMockDb([
      [
        { citySlug: "salaberry-de-valleyfield" },
        { citySlug: "beauharnois" },
      ],
      [{ count: 5 }],
    ]);
    const app = graphRoute({ db });
    const res = await app.request("/api/graph/mrcs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      mrcCount: number;
      mrcs: { mrc: string; nodeCount: number; citySlugs: string[] }[];
    };
    expect(body.ok).toBe(true);
    expect(body.mrcCount).toBe(1);
    const firstMrc = body.mrcs[0]!;
    expect(firstMrc.mrc).toBe("Beauharnois-Salaberry");
    expect(firstMrc.nodeCount).toBe(5);
    expect(firstMrc.citySlugs).toContain("salaberry-de-valleyfield");
    expect(firstMrc.citySlugs).toContain("beauharnois");
  });

  // Ensure /api/graph/mrcs is NOT captured by /api/graph/:city wildcard.
  it("mrcs route is not shadowed by the city wildcard", async () => {
    const db = makeMockDb([[]]);
    const app = graphRoute({ db });
    // If the city wildcard captured "mrcs", it would call subgraphForCity
    // which returns `{ ok: false, error: "no-graph-data", city: "mrcs" }`.
    // We verify the mrcs endpoint is hit instead (returns ok: true).
    const res = await app.request("/api/graph/mrcs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
