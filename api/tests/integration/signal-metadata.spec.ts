import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { signalMetadataFilterSchema } from "@radar/domain";
import { graphNodes } from "../../src/db/schema.js";
import { workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { bumpGraphSourceRevision } from "../../src/services/facets/projection-revisions.js";
import { metadataCellsSql, readSignalMetadata } from "../../src/services/facets/signal-metadata.js";
import { aggregateGraphSignalProjectionRows, lockCityGraph, upsertGraph, upsertGraphAtomic } from "../../src/services/graph/graph-store.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { targetFingerprint } from "../../src/services/facets/target.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { writeClassAnnotation } from "../../src/services/graph/class-annotations.js";
import { scopedProjectionRevisionsRoute } from "../../src/routes/scoped-projection-revisions.js";

const filter = signalMetadataFilterSchema.parse({});
const props = { properties: { category: "zonage", etape: "avis_motion", description: "Projet de quatre logements" },
  refs: [{ publishedAt: "2026-11-01", fetchedAt: "2026-11-03T15:00:00Z" },
    { publishedAt: "2026-11-02", fetchedAt: "2026-11-04T15:00:00Z" }] };

describe("fine signal metadata on PostgreSQL", () => {
  it("should match the current cube, count multidates once, rebuild idempotently and roll back with revisions", async () => {
    const f = await workspaceFixture();
    const citySlug = "metadata-city";
    await f.db.insert(graphNodes).values([
      { id: "known", type: "Signal", citySlug, label: "Projet de zonage résidentiel", props },
      { id: "unknown", type: "DesignationEvent", citySlug, label: "Projet de zonage résidentiel", props: {} },
      { id: "piia-description", type: "Signal", citySlug, label: "PIIA — secteur résidentiel",
        props: { properties: { category: "piia", etape: "adoption", description: "Projet de quatre logements" } } },
    ]);
    const refresh = () => f.db.transaction(async (tx) => {
      await lockCityGraph(tx, citySlug);
      return bumpGraphSourceRevision(tx, citySlug);
    });
    await refresh();
    const before = await f.pool.query("SELECT * FROM signal_metadata ORDER BY node_id");
    await refresh();
    expect((await f.pool.query("SELECT * FROM signal_metadata ORDER BY node_id")).rows).toEqual(before.rows);
    const stored = await f.db.select().from(graphNodes);
    const reference = aggregateGraphSignalProjectionRows(stored.map((row) => ({ ...row,
      category: (row.props as typeof props).properties?.category ?? null,
      etapeAnnote: (row.props as typeof props).properties?.etape ?? null,
      description: (row.props as typeof props).properties?.description ?? null,
    })));
    const actual = await readSignalMetadata(f.db, f.contributor.sub, f.workspaceId, filter);
    expect(actual.cities[0]?.facetsByClass.non_classe).toEqual(reference[0]?.filtreCube);
    for (const [dateBasis, dateFrom, dateTo] of [["document", "2026-11-01", "2026-11-02"],
      ["scrap", "2026-11-03", "2026-11-04"]]) {
      const scoped = await readSignalMetadata(f.db, f.contributor.sub, f.workspaceId,
        signalMetadataFilterSchema.parse({ dateBasis, dateFrom, dateTo }));
      expect(scoped.cities[0]?.classCounts.non_classe).toBe(1);
    }
    await expect(f.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE graph_nodes SET label='Changed' WHERE city_slug=${citySlug}`);
      await bumpGraphSourceRevision(tx, citySlug);
      throw new Error("abort projection");
    })).rejects.toThrow("abort projection");
    expect((await f.pool.query("SELECT * FROM signal_metadata ORDER BY node_id")).rows).toEqual(before.rows);
    const plan = await f.db.execute(sql`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)
      ${metadataCellsSql(f.contributor.id, f.workspaceId, filter)}`);
    const text = JSON.stringify(plan.rows);
    expect(text).toContain("signal_metadata");
    for (const forbidden of ["graph_nodes", "props", "description", "evidence"]) {
      expect(text).not.toContain(forbidden);
    }
    await f.pool.query("DELETE FROM signal_metadata_versions");
    await expect(readSignalMetadata(f.db, f.contributor.sub, f.workspaceId, filter))
      .rejects.toMatchObject({ status: 503, message: "signal_metadata_backfill_required" });
    // Exercise both production write paths in this fixture, rather than creating
    // another database solely to repeat their projection lifecycle assertions.
    const graph = { nodes: [{ id: "imported", file_type: "Signal", label: "Projet de zonage résidentiel",
      properties: { category: "zonage", etape: "avis_motion" } }], links: [] };
    await upsertGraph(f.db, "metadata-import", graph);
    const initial = await f.pool.query("SELECT filter_bits,version FROM signal_metadata WHERE city_slug='metadata-import'");
    expect(initial.rows).toEqual([{ filter_bits: expect.stringMatching(/^[01]{5}$/), version: 1 }]);
    const projected = await upsertGraphAtomic(f.db, "metadata-import", graph);
    expect(projected.aborted).not.toBe(true);
    expect((await f.pool.query("SELECT filter_bits,version FROM signal_metadata WHERE city_slug='metadata-import'")).rows)
      .toEqual(initial.rows);
  });

  it("should resolve personal and shared classes without leaking another reader or workspace", async () => {
    const f = await workspaceFixture();
    const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(), citySlug: "metadata-rights",
      type: "Signal", label: "Projet de zonage résidentiel", props }).returning();
    await f.db.transaction((tx) => bumpGraphSourceRevision(tx, node!.citySlug));
    const target = { citySlug: node!.citySlug, type: "Signal" as const, id: node!.id };
    const read = (sub: string, ws = f.workspaceId) => readSignalMetadata(f.db, sub, ws, filter);
    await expect(read(f.outsider.sub)).rejects.toMatchObject({ status: 403 });
    await expect(read("unknown-account")).rejects.toMatchObject({ status: 403 });
    await writeClassAnnotation(f.db, { citySlug: node!.citySlug, nodeType: "Signal", nodeId: node!.id,
      classe: "pertinent", reason: "Synthetic annotation", source: "ai", model: "synthetic", effort: "medium",
      promptId: "test", promptSha256: "a".repeat(64), inputSha256: "b".repeat(64), pipelineRunId: "test" });
    expect((await read(f.contributor.sub)).classCounts.pertinent).toBe(1);
    expect((await read(f.moderator.sub)).classCounts.pertinent).toBe(1);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: targetFingerprint(node!), commandKey: randomUUID() });
    expect((await read(f.contributor.sub)).classCounts.ecarte).toBe(1);
    expect((await read(f.moderator.sub)).classCounts.non_classe).toBe(1);
    expect((await read(f.contributor.sub, f.otherId)).classCounts.non_classe).toBe(1);
    await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: targetFingerprint(node!), commandKey: randomUUID() });
    expect((await read(f.moderator.sub)).classCounts.ecarte).toBe(1);
    expect((await read(f.contributor.sub, f.otherId)).classCounts.ecarte).toBe(0);
  });

  it("should version the HTTP contract explicitly and preserve the old reader", async () => {
    const f = await workspaceFixture();
    await f.db.insert(graphNodes).values({ id: "http", citySlug: "metadata-http", type: "Signal",
      label: "Projet de zonage résidentiel", props });
    await f.db.transaction((tx) => bumpGraphSourceRevision(tx, "metadata-http"));
    const app = (sub: string | null) => {
      const app = new Hono();
      app.use("*", async (c, next) => { c.set("session" as never, (sub ? { sub } : null) as never); await next(); });
      app.route("/", scopedProjectionRevisionsRoute({ db: f.db, auth: { enabled: true } }));
      return app;
    };
    const path = `/api/v1/workspaces/${f.workspaceId}/signal-facets/by-city`;
    expect((await app(null).request(`${path}?contract=metadata-v2`)).status).toBe(401);
    expect((await app(f.outsider.sub).request(`${path}?contract=metadata-v2`)).status).toBe(403);
    const member = app(f.contributor.sub);
    expect((await member.request(`${path}?contract=metadata-v3`)).status).toBe(400);
    expect((await member.request(`${path}?contract=metadata-v2&classes=invalid`)).status).toBe(400);
    const response = await member.request(`${path}?contract=metadata-v2&classes=none`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({ contract: "metadata-v2", totalMatched: 0, classCounts: { non_classe: 1 } });
    expect(JSON.stringify(body)).not.toMatch(/"(signals|props|description|evidence)"/);
    const old = await (await member.request(path)).json();
    expect(old).toMatchObject({ ok: true, totalCount: 1 });
    expect(old).not.toHaveProperty("contract");
  });
});
