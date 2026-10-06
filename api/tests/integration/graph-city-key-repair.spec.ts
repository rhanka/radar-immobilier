/**
 * GH #812 — city-key repair end to end on Postgres (spec K10/K11, §7.2).
 *
 * Seeds the contamination observed in prod after migration 0013 (the rows keep
 * the content another city wrote under the old key `(id)`), then runs the repair
 * transaction of `city-key-repair.ts` with the cities' own S3 graphs given as
 * projections (no object store needed).
 *
 *   gore     : (gore, bylaw-242) holds barkmere's content → plain projection refused
 *              (like prod since 2026-10-02), repair passes, second run is a no-op.
 *   barkmere : has no bylaw-242 row at all (the #820 guard skipped it) → inserted.
 *   mixed    : barkmere's ref merged with a local ref gore's file dropped → unknown,
 *              refused before any mutation.
 *   lossy    : the city's own file lost a citation (G5c) → refused by the guard.
 */
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";
import { createDb, type Database } from "../../src/db/client.js";
import { graphEdges, graphNodes } from "../../src/db/schema.js";
import {
  comparable,
  idsWithLostContent,
  repairCity,
  type ComparableNodeRow,
} from "../../src/services/graph/city-key-repair.js";
import { prepareCityProjection, upsertGraphAtomic, type CityProjection } from "../../src/services/graph/graph-store.js";

const P = "__812r_";
const GORE = `${P}gore`;
const BARK = `${P}barkmere`;
const MIXED = `${P}mixed`;
const LOSSY = `${P}lossy`;

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
  await db.delete(graphEdges).where(like(graphEdges.citySlug, `${P}%`));
  await db.delete(graphNodes).where(like(graphNodes.citySlug, `${P}%`));
}

const ref = (city: string, sha: string, excerpt = `${city} ${sha}`) => ({
  docSha: sha,
  rawRef: `raw/proces-verbaux-${city}/cas/${sha}.pdf`,
  excerpt,
  page: 2,
});

const s3 = {
  [GORE]: {
    nodes: [
      { id: "bylaw-242", type: "Bylaw", label: "Règlement 242 (gore)", refs: [ref("gore", "G1")], properties: { numero: "242" } },
      { id: "zone-c-6", type: "Zone", label: "C-6 (gore)" },
      { id: "sig-1", type: "Signal", label: "Avis 242", refs: [ref("gore", "G1")] },
    ],
    edges: [{ source: "bylaw-242", target: "zone-c-6", type: "regulates" }],
  },
  [BARK]: {
    nodes: [
      { id: "bylaw-242", type: "Bylaw", label: "Règlement 242 (barkmere)", refs: [ref("barkmere", "B1")], properties: { resolution: "2026-14" } },
      { id: "zone-c-6", type: "Zone", label: "C-6 (barkmere)" },
    ],
    edges: [{ source: "bylaw-242", target: "zone-c-6", type: "regulates" }],
  },
};

function projections(): Record<string, CityProjection> {
  return {
    [GORE]: prepareCityProjection(GORE, s3[GORE]),
    [BARK]: prepareCityProjection(BARK, s3[BARK]),
  };
}

/** Same-id rows of every city's S3 file (what the CLI builds in phase 2). */
function indexOf(all: Record<string, CityProjection>): Map<string, Array<{ city: string; row: ComparableNodeRow }>> {
  const index = new Map<string, Array<{ city: string; row: ComparableNodeRow }>>();
  for (const [city, projection] of Object.entries(all)) {
    for (const row of projection.nodeRows) {
      const list = index.get(row.id) ?? [];
      list.push({ city, row: comparable(row) });
      index.set(row.id, list);
    }
  }
  return index;
}

async function insertRow(city: string, id: string, node: Record<string, unknown>): Promise<void> {
  const built = prepareCityProjection(city, { nodes: [node] }).nodeRows[0]!;
  await db.insert(graphNodes).values({ id, citySlug: city, type: built.type, label: built.label, props: built.props, sourceRef: built.sourceRef });
}

/** gore holds barkmere's bylaw-242 content; its other rows are its own; barkmere lacks bylaw-242. */
async function seedContamination(): Promise<void> {
  await insertRow(GORE, "bylaw-242", s3[BARK].nodes[0]!);
  await insertRow(GORE, "zone-c-6", s3[GORE].nodes[1]!);
  await insertRow(GORE, "sig-1", s3[GORE].nodes[2]!);
  await db.insert(graphEdges).values({ citySlug: GORE, srcId: "bylaw-242", dstId: "zone-c-6", kind: "regulates", props: {} });
  await insertRow(BARK, "zone-c-6", s3[BARK].nodes[1]!);
}

async function goreBylaw() {
  const [row] = await db.select().from(graphNodes).where(eq(graphNodes.citySlug, GORE)).then((rows) => rows.filter((r) => r.id === "bylaw-242"));
  return row;
}

describe("GH #812 — city-key repair", () => {
  it("reproduction: the plain projection of the contaminated city is refused", async () => {
    await seedContamination();
    const plain = await upsertGraphAtomic(db, GORE, s3[GORE]);
    expect(plain.aborted).toBe(true);
    expect((await goreBylaw())!.label).toBe("Règlement 242 (barkmere)");
  });

  it("preview: classifies, predicts pass, and writes nothing", async () => {
    await seedContamination();
    const all = projections();
    const report = await repairCity(db, all[GORE]!, indexOf(all), "preview");
    expect(report.before.verdict).toBe("refused");
    expect(report.classes).toEqual({ clean: 2, foreign: 1, unknown: 0 });
    expect(report.foreignNodes).toEqual([{ id: "bylaw-242", explainedBy: [BARK] }]);
    expect(report.verdict).toBe("pass");
    expect(report.applied).toBe(false);
    expect(report.noop).toBe(false);
    expect((await goreBylaw())!.label).toBe("Règlement 242 (barkmere)");
  });

  it("apply: re-aligns the city on its own file; the second run is a no-op", async () => {
    await seedContamination();
    const all = projections();
    const applied = await repairCity(db, all[GORE]!, indexOf(all), "apply");
    expect(applied.verdict).toBe("pass");
    expect(applied.applied).toBe(true);
    const fixed = (await goreBylaw())!;
    expect(fixed.label).toBe("Règlement 242 (gore)");
    expect(JSON.stringify(fixed.props)).not.toContain("B1");

    const again = await repairCity(db, all[GORE]!, indexOf(all), "preview");
    expect(again.noop).toBe(true);
    expect(again.classes.foreign).toBe(0);
    expect(again.before.verdict).toBe("pass");
    // …and the regular projection passes again.
    expect((await upsertGraphAtomic(db, GORE, s3[GORE])).aborted).toBe(false);
  });

  it("the city that lost its node to the collision receives it", async () => {
    await seedContamination();
    const all = projections();
    const report = await repairCity(db, all[BARK]!, indexOf(all), "apply");
    expect(report.drift.idsMissingInPg).toBe(1);
    expect(report.verdict).toBe("pass");
    const rows = await db.select().from(graphNodes).where(eq(graphNodes.citySlug, BARK));
    expect(rows.map((r) => r.id).sort()).toEqual(["bylaw-242", "zone-c-6"]);
    const edges = await db.select().from(graphEdges).where(eq(graphEdges.citySlug, BARK));
    expect(edges).toHaveLength(1);
  });

  it("refuses a city with an unknown row before any mutation", async () => {
    const mixedGraph = { nodes: [{ id: "bylaw-242", type: "Bylaw", label: "242", refs: [ref("mixed", "M1")] }] };
    // PG: barkmere's ref merged with a local ref (M0) that the mixed city's file no longer carries.
    await insertRow(MIXED, "bylaw-242", { id: "bylaw-242", type: "Bylaw", label: "Règlement 242 (barkmere)", refs: [ref("mixed", "M0"), ref("barkmere", "B1")], properties: { resolution: "2026-14" } });
    const all = { ...projections(), [MIXED]: prepareCityProjection(MIXED, mixedGraph) };
    const report = await repairCity(db, all[MIXED]!, indexOf(all), "apply");
    expect(report.verdict).toBe("refused-unknown");
    expect(report.unknownNodes.map((n) => n.id)).toEqual(["bylaw-242"]);
    expect(report.applied).toBe(false);
    const [row] = await db.select().from(graphNodes).where(eq(graphNodes.citySlug, MIXED));
    expect(JSON.stringify(row!.props)).toContain("M0");
  });

  it("a local loss in the city's own file (G5c) is refused by the unchanged guard and rolled back", async () => {
    const complete = { nodes: [{ id: "sig-1", type: "Signal", label: "Avis", refs: [ref("lossy", "L1")] }] };
    expect((await upsertGraphAtomic(db, LOSSY, complete)).aborted).toBe(false);
    const lossy = { nodes: [{ id: "sig-1", type: "Signal", label: "Avis", refs: [{ docSha: "L1", page: 2 }] }] };
    const all = { [LOSSY]: prepareCityProjection(LOSSY, lossy) };
    const report = await repairCity(db, all[LOSSY]!, indexOf(all), "apply");
    expect(report.verdict).toBe("refused-guard");
    expect(report.applied).toBe(false);
    const [row] = await db.select().from(graphNodes).where(eq(graphNodes.citySlug, LOSSY));
    expect(JSON.stringify(row!.props)).toContain("excerpt");
  });

  it("A-R5-1: an edge whose evidence another city overwrote is detected and re-aligned", async () => {
    // Nodes are gore's own; the shared edge triple carries barkmere's evidence (the #820 guard
    // protected nodes, not edges), and migration 0013 placed it at gore through its src node.
    await insertRow(GORE, "bylaw-242", s3[GORE].nodes[0]!);
    await insertRow(GORE, "zone-c-6", s3[GORE].nodes[1]!);
    await insertRow(GORE, "sig-1", s3[GORE].nodes[2]!);
    await db.insert(graphEdges).values({ citySlug: GORE, srcId: "bylaw-242", dstId: "zone-c-6", kind: "regulates", props: { refs: [ref("barkmere", "B1")] } });
    const all = projections();
    const preview = await repairCity(db, all[GORE]!, indexOf(all), "preview");
    expect(preview.classes.foreign).toBe(0);
    expect(preview.drift.edgesContentDiff).toBe(1);
    expect(preview.noop).toBe(false);
    const applied = await repairCity(db, all[GORE]!, indexOf(all), "apply");
    expect(applied.verdict).toBe("pass");
    const [edge] = await db.select().from(graphEdges).where(eq(graphEdges.citySlug, GORE));
    expect(JSON.stringify(edge!.props)).not.toContain("B1");
    expect((await repairCity(db, all[GORE]!, indexOf(all), "preview")).noop).toBe(true);
  });

  it("phase 1 selects only the contaminated ids", async () => {
    await seedContamination();
    const all = projections();
    const pgRows = (await db.select().from(graphNodes).where(eq(graphNodes.citySlug, GORE)))
      .map((row) => comparable({ ...row, props: (row.props ?? {}) as Record<string, unknown> }));
    expect(idsWithLostContent(pgRows, all[GORE]!)).toEqual(["bylaw-242"]);
  });
});
