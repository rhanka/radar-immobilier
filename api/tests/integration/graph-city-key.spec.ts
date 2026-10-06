/**
 * GH #812 — graph city key `(city_slug, id)` (spec docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md).
 *
 * Reproduction first: graphify node ids are unique inside ONE city only
 * (`bylaw-242` exists in gore AND barkmere). With the old primary key `(id)` the
 * second city overwrote the first city's row (contamination), and with the
 * interim guard of #820 the second city silently did not receive its node.
 * With the key `(city_slug, id)` each city owns its id space, exactly like S3
 * `graph/<city>/latest.json`.
 */
import { and, eq, inArray, like, or } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import { createDb, type Database } from "../../src/db/client.js";
import { geoResolutions, graphEdges, graphNodes } from "../../src/db/schema.js";
import {
  lockCityGraph,
  queryNeighbors,
  subgraphForCity,
  subgraphForMrc,
  upsertGraph,
  upsertGraphAtomic,
} from "../../src/services/graph/graph-store.js";
import { insertResolution } from "../../src/services/geo/resolve-refs.js";

// Two real cities of the same MRC (Beauharnois-Salaberry) so subgraphForMrc sees both;
// every node id of this file starts with PREFIX and only those rows are cleaned.
const A = "salaberry-de-valleyfield";
const B = "beauharnois";
const PREFIX = "__812_";
const SHARED = `${PREFIX}bylaw-242`;
const ZONE = `${PREFIX}zone-c-6`;

let db: Database;
let pool: ReturnType<typeof createDb>["pool"];

beforeAll(() => {
  ({ db, pool } = createDb(loadConfig()));
});
afterAll(async () => {
  await clean();
  await pool.end();
});
beforeEach(async () => {
  await clean();
});

async function clean(): Promise<void> {
  await db.delete(graphEdges).where(or(like(graphEdges.srcId, `${PREFIX}%`), like(graphEdges.dstId, `${PREFIX}%`)));
  await db.delete(graphNodes).where(like(graphNodes.id, `${PREFIX}%`));
  await db.delete(geoResolutions).where(like(geoResolutions.nodeId, `${PREFIX}%`));
}

function cityGraph(city: string, extra: { withEdge?: boolean; extraNode?: boolean } = {}) {
  const sha = `SHA_${city}`;
  return {
    nodes: [
      {
        id: SHARED,
        type: "Bylaw",
        label: `Règlement 242 (${city})`,
        refs: [{ docSha: sha, rawRef: `raw/proces-verbaux-${city}/cas/${sha}.pdf`, excerpt: `${city} 242`, page: 1 }],
        properties: { numero: `242-${city}` },
      },
      { id: ZONE, type: "Zone", label: `C-6 (${city})` },
      ...(extra.extraNode ? [{ id: `${PREFIX}${city}-only`, type: "Zone", label: `propre à ${city}` }] : []),
    ],
    edges: extra.withEdge === false ? [] : [{ source: SHARED, target: ZONE, type: "regulates", refs: [{ docSha: sha }] }],
  };
}

async function rowsById(id: string) {
  return db.select().from(graphNodes).where(eq(graphNodes.id, id));
}

describe("GH #812 — two cities, same node id", () => {
  it("reproduction: both cities keep their own row and content (no overwrite, no skip)", async () => {
    expect((await upsertGraphAtomic(db, A, cityGraph(A))).aborted).toBe(false);
    expect((await upsertGraphAtomic(db, B, cityGraph(B))).aborted).toBe(false);

    const rows = await rowsById(SHARED);
    expect(rows).toHaveLength(2);
    const byCity = new Map(rows.map((row) => [row.citySlug, row]));
    expect(byCity.get(A)!.label).toBe(`Règlement 242 (${A})`);
    expect(byCity.get(B)!.label).toBe(`Règlement 242 (${B})`);
    expect(JSON.stringify(byCity.get(A)!.props)).not.toContain(`SHA_${B}`);
    expect(JSON.stringify(byCity.get(B)!.props)).not.toContain(`SHA_${A}`);

    // Each city serves its node (the #820 guard left B without it).
    expect((await subgraphForCity(db, B)).nodes.map((n) => n.id)).toContain(SHARED);
  });

  it("the gore case: the first city's next projection is not refused after the second city wrote", async () => {
    await upsertGraphAtomic(db, A, cityGraph(A));
    await upsertGraphAtomic(db, B, cityGraph(B));
    const again = await upsertGraphAtomic(db, A, cityGraph(A));
    expect(again.aborted).toBe(false);
    expect(again.reason).toBeUndefined();
  });

  it("the legacy freshness upsert (upsertGraph) is city-scoped too", async () => {
    await upsertGraph(db, A, cityGraph(A));
    await upsertGraph(db, B, cityGraph(B));
    const rows = await rowsById(SHARED);
    expect(rows.map((row) => row.citySlug).sort()).toEqual([B, A].sort());
    expect(rows.find((row) => row.citySlug === A)!.label).toBe(`Règlement 242 (${A})`);
  });

  it("the same edge triple in two cities is two rows; each city serves only its own edge", async () => {
    await upsertGraphAtomic(db, A, cityGraph(A));
    await upsertGraphAtomic(db, B, cityGraph(B));
    const edges = await db.select().from(graphEdges).where(eq(graphEdges.srcId, SHARED));
    expect(edges.map((e) => e.citySlug).sort()).toEqual([A, B].sort());

    const subA = await subgraphForCity(db, A);
    const mine = subA.edges.filter((e) => e.srcId === SHARED);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.citySlug).toBe(A);
    expect(JSON.stringify(mine[0]!.props)).toContain(`SHA_${A}`);
  });

  it("a projection deletes ITS stale edges and orphan nodes only, never the other city's", async () => {
    await upsertGraphAtomic(db, A, cityGraph(A, { extraNode: true }));
    await upsertGraphAtomic(db, B, cityGraph(B, { extraNode: true }));

    // A drops its edge and its extra node; B keeps both.
    const reduced = await upsertGraphAtomic(db, A, cityGraph(A, { withEdge: false }));
    expect(reduced.aborted).toBe(false);
    expect(reduced.deletedStaleEdges).toBe(1);
    expect(reduced.deletedNodes).toBe(1);

    const edges = await db.select().from(graphEdges).where(eq(graphEdges.srcId, SHARED));
    expect(edges.map((e) => e.citySlug)).toEqual([B]);
    expect((await rowsById(`${PREFIX}${B}-only`)).map((row) => row.citySlug)).toEqual([B]);
  });

  it("the dangling-edge purge of an orphan id stays in the city", async () => {
    // Both cities hold an edge towards their own `<prefix>tmp` node; A then drops the node.
    const withTmp = (city: string) => ({
      nodes: [...cityGraph(city).nodes, { id: `${PREFIX}tmp`, type: "Zone", label: "tmp" }],
      edges: [{ source: SHARED, target: `${PREFIX}tmp`, type: "touches" }],
    });
    await upsertGraphAtomic(db, A, withTmp(A));
    await upsertGraphAtomic(db, B, withTmp(B));
    const result = await upsertGraphAtomic(db, A, { nodes: cityGraph(A).nodes, edges: [] });
    expect(result.aborted).toBe(false);
    expect(result.deletedEdges).toBe(1);

    const left = await db.select().from(graphEdges).where(eq(graphEdges.dstId, `${PREFIX}tmp`));
    expect(left.map((e) => e.citySlug)).toEqual([B]);
    expect((await rowsById(`${PREFIX}tmp`)).map((row) => row.citySlug)).toEqual([B]);
  });

  it("A-R5-2: an edge whose src node is absent (placed by its dst at migration) is never served", async () => {
    await upsertGraphAtomic(db, A, cityGraph(A));
    await db.insert(graphEdges).values({ citySlug: A, srcId: `${PREFIX}ghost`, dstId: ZONE, kind: "cites", props: {} });
    const sub = await subgraphForCity(db, A);
    expect(sub.edges.some((e) => e.srcId === `${PREFIX}ghost`)).toBe(false);
    // …and the next projection of the city deletes it (not in its latest.json).
    const again = await upsertGraphAtomic(db, A, cityGraph(A));
    expect(again.deletedStaleEdges).toBe(1);
  });

  it("queryNeighbors binds the city", async () => {
    await upsertGraphAtomic(db, A, cityGraph(A));
    await upsertGraphAtomic(db, B, cityGraph(B));
    const neighbours = await queryNeighbors(db, A, SHARED);
    expect(neighbours).toHaveLength(1);
    expect(neighbours[0]!.edge.citySlug).toBe(A);
    expect(neighbours[0]!.node.citySlug).toBe(A);
    expect(neighbours[0]!.node.label).toBe(`C-6 (${A})`);
  });

  it("subgraphForMrc keeps (A, x) and (B, x) and resolves each edge in its own city", async () => {
    await upsertGraphAtomic(db, A, cityGraph(A));
    await upsertGraphAtomic(db, B, cityGraph(B));
    const mrc = await subgraphForMrc(db, "Beauharnois-Salaberry");
    expect(mrc.citySlugs).toEqual(expect.arrayContaining([A, B]));
    const shared = mrc.nodes.filter((n) => n.id === SHARED);
    expect(shared.map((n) => n.citySlug).sort()).toEqual([A, B].sort());
    const sharedEdges = mrc.edges.filter((e) => e.srcId === SHARED);
    expect(sharedEdges.map((e) => e.citySlug).sort()).toEqual([A, B].sort());
  });

  it("a projection of a city waits for the per-city lock held by another writer", async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => { locked = resolve; });

    const holder = db.transaction(async (tx) => {
      await lockCityGraph(tx, A);
      locked();
      await held;
      order.push("holder-commit");
    });
    await lockTaken;
    const projection = upsertGraphAtomic(db, A, cityGraph(A)).then((r) => { order.push("projection-done"); return r; });
    // Give the projection time to block on the advisory lock.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(order).toEqual([]);
    release();
    await holder;
    expect((await projection).aborted).toBe(false);
    expect(order).toEqual(["holder-commit", "projection-done"]);
  });

  it("geo_resolutions: the same node id in two cities resolving the same lot is two rows", async () => {
    const base = {
      nodeId: SHARED,
      nodeType: "Signal",
      relationType: "concerns_lot",
      targetId: `${PREFIX}lot-1`,
      targetType: "Lot" as const,
      extraitBrut: "lot 1",
      scoreConfiance: 0.9,
      provenance: "lot_explicit",
      asOfDate: null,
    };
    await insertResolution(db, { ...base, citySlug: A });
    await insertResolution(db, { ...base, citySlug: B });
    await insertResolution(db, { ...base, citySlug: B }); // idempotent
    const rows = await db
      .select({ citySlug: geoResolutions.citySlug })
      .from(geoResolutions)
      .where(and(eq(geoResolutions.nodeId, SHARED), inArray(geoResolutions.citySlug, [A, B])));
    expect(rows.map((row) => row.citySlug).sort()).toEqual([A, B].sort());
  });
});
