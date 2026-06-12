/**
 * WP A.3.1 — Graph store unit tests.
 *
 * Tests are split into two tiers:
 *
 *  1. PURE (always run): row builders, Zod parsing, idempotency logic.
 *     No DB required.
 *
 *  2. DB-BOUND (skipped when POSTGRES_HOST is unset): upsert idempotency,
 *     queryNeighbors, subgraphForCity. The orchestrator runs these in series
 *     after the Postgres stack is up (ENV=test-graphdb).
 */

import { describe, it, expect } from "vitest";
import {
  buildNodeRow,
  buildEdgeRow,
  graphifyGraphSchema,
  upsertGraph,
  queryNeighbors,
  subgraphForCity,
  subgraphForMrc,
  listMrcs,
  type GraphifyNode,
  type GraphifyLink,
} from "./graph-store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_GRAPH = {
  directed: false,
  multigraph: false,
  nodes: [
    { id: "zone_a", label: "Zone A", file_type: "concept", source_file: "test.md", community: 0 },
    { id: "bylaw_1", label: "Bylaw 1", file_type: "document", source_file: "test.md", community: 1 },
    { id: "lot_x", label: "Lot X", file_type: "concept", source_file: "test.md", community: 0 },
  ],
  links: [
    {
      source: "zone_a",
      target: "bylaw_1",
      relation: "régi_par",
      confidence: "EXTRACTED",
      confidence_score: 1,
      source_file: "test.md",
    },
    {
      source: "lot_x",
      target: "zone_a",
      relation: "dans",
      confidence: "EXTRACTED",
      confidence_score: 0.9,
      source_file: "test.md",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pure tests — always run
// ─────────────────────────────────────────────────────────────────────────────

describe("buildNodeRow", () => {
  it("maps graphify node to DB row", () => {
    const node: GraphifyNode = {
      id: "zone_a",
      label: "Zone A",
      file_type: "concept",
      source_file: "test.md",
      community: 0,
    };
    const row = buildNodeRow(node, "valleyfield");
    expect(row.id).toBe("zone_a");
    expect(row.label).toBe("Zone A");
    expect(row.type).toBe("concept");
    expect(row.citySlug).toBe("valleyfield");
    expect(row.sourceRef).toBe("test.md");
    expect(row.props).toMatchObject({ community: 0, source_file: "test.md" });
  });

  it("defaults type to 'concept' when file_type is absent", () => {
    const node: GraphifyNode = { id: "x", label: "X" };
    const row = buildNodeRow(node, null);
    expect(row.type).toBe("concept");
    expect(row.citySlug).toBeNull();
  });
});

describe("buildEdgeRow", () => {
  it("maps graphify link to DB edge row", () => {
    const link: GraphifyLink = {
      source: "zone_a",
      target: "bylaw_1",
      relation: "régi_par",
      confidence: "EXTRACTED",
      confidence_score: 1,
    };
    const row = buildEdgeRow(link);
    expect(row.srcId).toBe("zone_a");
    expect(row.dstId).toBe("bylaw_1");
    expect(row.kind).toBe("régi_par");
    expect(row.props).toMatchObject({ confidence: "EXTRACTED", confidence_score: 1 });
  });
});

describe("graphifyGraphSchema", () => {
  it("parses a valid graph.json", () => {
    const result = graphifyGraphSchema.safeParse(FIXTURE_GRAPH);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.nodes).toHaveLength(3);
    expect(result.data.links).toHaveLength(2);
  });

  it("accepts `edges` key in place of `links`", () => {
    const g = { nodes: FIXTURE_GRAPH.nodes, edges: FIXTURE_GRAPH.links };
    const result = graphifyGraphSchema.safeParse(g);
    expect(result.success).toBe(true);
  });

  it("rejects input without nodes", () => {
    const result = graphifyGraphSchema.safeParse({ links: [] });
    expect(result.success).toBe(false);
  });

  it("accepts graph with no links/edges (nodes-only snapshot)", () => {
    const result = graphifyGraphSchema.safeParse({ nodes: [] });
    expect(result.success).toBe(true);
  });
});

describe("buildNodeRow — idempotency key", () => {
  it("produces same id for same node regardless of citySlug", () => {
    const node: GraphifyNode = { id: "zone_a", label: "Zone A" };
    const r1 = buildNodeRow(node, "valleyfield");
    const r2 = buildNodeRow(node, "valleyfield");
    expect(r1.id).toBe(r2.id);
    expect(r1.label).toBe(r2.label);
  });
});

describe("buildEdgeRow — idempotency key", () => {
  it("produces same (srcId, dstId, kind) for same link", () => {
    const link: GraphifyLink = { source: "a", target: "b", relation: "r" };
    const r1 = buildEdgeRow(link);
    const r2 = buildEdgeRow(link);
    expect(`${r1.srcId}|${r1.dstId}|${r1.kind}`).toBe(`${r2.srcId}|${r2.dstId}|${r2.kind}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. MRC aggregation — pure (mock DB, no Postgres)
// ─────────────────────────────────────────────────────────────────────────────
// These tests stub the Database at the Drizzle builder level using simple
// inline mocks. They exercise QC_MUNICIPALITIES look-up logic and routing
// without requiring Postgres.

describe("subgraphForMrc — unknown MRC returns empty", () => {
  it("returns empty when MRC not in QC_MUNICIPALITIES", async () => {
    // We need a db that will never be queried for the empty-cities path.
    // Build a minimal db mock that returns empty arrays unconditionally.
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
      selectDistinct: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await subgraphForMrc(db as any, "__mrc_that_does_not_exist__");
    expect(result.citySlugs).toHaveLength(0);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});

describe("subgraphForMrc — known MRC with no ingested data returns empty", () => {
  it("returns empty nodes array when DB has no rows for MRC cities", async () => {
    // "Beauharnois-Salaberry" is a real MRC in QC_MUNICIPALITIES.
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await subgraphForMrc(db as any, "Beauharnois-Salaberry");
    // citySlugs should be populated (cities exist in QC_MUNICIPALITIES).
    expect(result.citySlugs.length).toBeGreaterThan(0);
    // But nodes should be empty (nothing in DB).
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.mrc).toBe("Beauharnois-Salaberry");
  });
});

describe("listMrcs — pure: returns empty when DB has no nodes", () => {
  it("returns empty array when no graph nodes exist", async () => {
    const db = {
      selectDistinct: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await listMrcs(db as any);
    expect(result).toEqual([]);
  });
});

describe("subgraphForMrc — QC_MUNICIPALITIES MRC membership", () => {
  it("Beauharnois-Salaberry contains salaberry-de-valleyfield and beauharnois", async () => {
    const { QC_MUNICIPALITIES } = await import("@radar/sources");
    const cities = QC_MUNICIPALITIES.filter((m) => m.mrc === "Beauharnois-Salaberry");
    const slugs = cities.map((c) => c.slug);
    expect(slugs).toContain("salaberry-de-valleyfield");
    expect(slugs).toContain("beauharnois");
  });

  it("Roussillon contains sainte-catherine and saint-constant", async () => {
    const { QC_MUNICIPALITIES } = await import("@radar/sources");
    const cities = QC_MUNICIPALITIES.filter((m) => m.mrc === "Roussillon");
    const slugs = cities.map((c) => c.slug);
    expect(slugs).toContain("sainte-catherine");
    expect(slugs).toContain("saint-constant");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. queryNeighbors — pure mock (N+1 fix)
//
// Vérifie que queryNeighbors charge les nœuds voisins en UNE seule requête
// inArray, et non par un SELECT par arête (ancien comportement N+1).
// Le mock compte les appels .where() sur graphNodes pour détecter la régression.
// ─────────────────────────────────────────────────────────────────────────────

describe("queryNeighbors — fix N+1 : un seul inArray pour les nœuds voisins", () => {
  it("retourne les voisins out/in avec un seul SELECT sur graphNodes", async () => {
    // Arêtes renvoyées par les deux premiers SELECT (outEdges + inEdges)
    const outEdgesFixture = [
      { srcId: "zone_a", dstId: "bylaw_1", kind: "régi_par", id: "e1", props: {}, createdAt: new Date() },
    ];
    const inEdgesFixture = [
      { srcId: "lot_x", dstId: "zone_a", kind: "dans", id: "e2", props: {}, createdAt: new Date() },
    ];
    // Nœuds renvoyés par le SELECT inArray (un seul appel attendu)
    const nodesFixture = [
      { id: "bylaw_1", label: "Bylaw 1", type: "document", citySlug: "valleyfield", props: {}, sourceRef: null, createdAt: new Date() },
      { id: "lot_x",   label: "Lot X",   type: "concept",  citySlug: "valleyfield", props: {}, sourceRef: null, createdAt: new Date() },
    ];

    let nodeSelectCount = 0;
    let callIdx = 0;
    // Séquence d'appels db.select() :
    //   0 → outEdges (where srcId = nodeId)
    //   1 → inEdges  (where dstId = nodeId)
    //   2 → inArray  (unique SELECT des nœuds voisins)
    const responses = [outEdgesFixture, inEdgesFixture, nodesFixture];

    const db = {
      select: () => {
        const idx = callIdx++;
        const isNodeSelect = idx === 2;
        if (isNodeSelect) nodeSelectCount++;
        return {
          from: () => ({
            where: () => Promise.resolve(responses[idx] ?? []),
          }),
        };
      },
    } as unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await queryNeighbors(db as any, "zone_a");

    // Un seul SELECT sur graphNodes pour tous les voisins
    expect(nodeSelectCount).toBe(1);

    // Résultats corrects
    const outNeighbors = result.filter((n) => n.direction === "out");
    const inNeighbors  = result.filter((n) => n.direction === "in");
    expect(outNeighbors).toHaveLength(1);
    expect(inNeighbors).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(outNeighbors[0]!.node.id).toBe("bylaw_1");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(inNeighbors[0]!.node.id).toBe("lot_x");
  });

  it("retourne un tableau vide quand il n'y a aucune arête", async () => {
    let callIdx = 0;
    const db = {
      select: () => {
        callIdx++;
        return {
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        };
      },
    } as unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await queryNeighbors(db as any, "node_orphelin");
    // Aucune arête → pas de SELECT sur graphNodes (court-circuit)
    expect(callIdx).toBe(2); // seulement outEdges + inEdges
    expect(result).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DB-bound tests — skipped when no POSTGRES_HOST env var
// ─────────────────────────────────────────────────────────────────────────────

// DB-bound tests only run when the orchestrator sets GRAPH_DB_TESTS=1, which
// it does when Postgres is confirmed reachable (ENV=test-graphdb full stack).
// This avoids false-positives when POSTGRES_HOST is set in container env but
// the postgres service is not actually started (--no-deps mode).
const DB_AVAILABLE = process.env.GRAPH_DB_TESTS === "1";

describe.skipIf(!DB_AVAILABLE)("DB-bound: upsertGraph (integration)", () => {
  // These tests require a live Postgres with the graph_store migration applied.
  // The orchestrator runs them serially with ENV=test-graphdb.

  async function getDb() {
    const { createDb } = await import("../../db/client.js");
    const { loadConfig } = await import("../../config.js");
    // Pass only DB-relevant env vars to avoid Zod failures on optional fields
    // (e.g. RADAR_ONTOLOGY_WRITE_TOKEN) that are not needed for graph tests.
    const config = loadConfig({
      POSTGRES_HOST: process.env.POSTGRES_HOST ?? "postgres",
      POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5432",
      POSTGRES_USER: process.env.POSTGRES_USER ?? "radar",
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "changeme-dev-only",
      POSTGRES_DB: process.env.POSTGRES_DB ?? "radar",
    });
    return createDb(config).db;
  }

  it("upserts without error and returns correct counts", async () => {
    const db = await getDb();
    const result = await upsertGraph(db, "valleyfield", FIXTURE_GRAPH);
    expect(result.nodeCount).toBe(3);
    expect(result.edgeCount).toBe(2);
  });

  it("is idempotent — second upsert returns same counts, no duplicates", async () => {
    const db = await getDb();
    await upsertGraph(db, "valleyfield", FIXTURE_GRAPH);
    const result = await upsertGraph(db, "valleyfield", FIXTURE_GRAPH);
    expect(result.nodeCount).toBe(3);
    expect(result.edgeCount).toBe(2);

    // Verify no duplicate edges in the DB for the fixture graph
    const { graphEdges } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const edges = await db.select().from(graphEdges).where(eq(graphEdges.srcId, "zone_a"));
    const fromZoneA = edges.filter((e) => e.dstId === "bylaw_1" && e.kind === "régi_par");
    expect(fromZoneA).toHaveLength(1);
  });

  it("queryNeighbors returns outgoing and incoming edges for a node", async () => {
    const db = await getDb();
    await upsertGraph(db, "valleyfield", FIXTURE_GRAPH);
    const neighbors = await queryNeighbors(db, "zone_a");
    const outgoing = neighbors.filter((n) => n.direction === "out");
    const incoming = neighbors.filter((n) => n.direction === "in");
    expect(outgoing.length).toBeGreaterThan(0);
    expect(incoming.length).toBeGreaterThan(0);
    const bylaw = outgoing.find((n) => n.node.id === "bylaw_1");
    expect(bylaw).toBeDefined();
    const lotX = incoming.find((n) => n.node.id === "lot_x");
    expect(lotX).toBeDefined();
  });

  it("subgraphForCity returns nodes and intra-city edges", async () => {
    const db = await getDb();
    await upsertGraph(db, "valleyfield", FIXTURE_GRAPH);
    const subgraph = await subgraphForCity(db, "valleyfield");
    expect(subgraph.nodes.length).toBe(3);
    expect(subgraph.edges.length).toBe(2);
    expect(subgraph.citySlug).toBe("valleyfield");
  });

  it("subgraphForCity returns empty for unknown city", async () => {
    const db = await getDb();
    const subgraph = await subgraphForCity(db, "__city_that_does_not_exist__");
    expect(subgraph.nodes).toHaveLength(0);
    expect(subgraph.edges).toHaveLength(0);
  });
});
