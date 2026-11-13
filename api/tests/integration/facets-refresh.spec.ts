import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "../../src/db/client.js";
import { loadConfig } from "../../src/config.js";
import { facetEvents, graphSourceRevisions, workspaceProjectionRevisions } from "../../src/db/schema.js";
import { graphSignalsRoute } from "../../src/routes/graph-signals.js";
import { protect } from "../../src/routes/auth.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { createDiscardedSignalsReader } from "../../src/services/facets/discarded-reader.js";
import { readCityFacets } from "../../src/services/facets/reader.js";
import { upsertGraphAtomic } from "../../src/services/graph/graph-store.js";
import { facetFixture, writeDisplayedFacet as writeFacet } from "./facets-fixture.js";
import { facetAuth, facetCookie } from "./facets-http-fixture.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it("should retain personal archive identity through real graph refreshes", async () => {
  const alice = await facetFixture(db);
  const bob = await facetFixture(db);
  const { target } = alice;
  const original = { id: target.id, type: target.type, label: "Synthetic signal", properties: { usage: "residential" } };
  const keep = { ...original, id: "keep-id", label: "Keep signal" };
  const refresh = async (nodes: unknown[], removed: string[] = []) => {
    const result = await upsertGraphAtomic(db, target.citySlug, { nodes, edges: [] }, new Set(removed));
    expect(result.aborted).toBe(false);
  };
  await refresh([original, keep]);
  const sourceRevisions = () => db.select().from(graphSourceRevisions)
    .where(eq(graphSourceRevisions.citySlug, target.citySlug));
  const sharedRevisions = () => db.select().from(workspaceProjectionRevisions)
    .where(eq(workspaceProjectionRevisions.citySlug, target.citySlug));
  const initialSourceRevisions = await sourceRevisions();
  const initialSharedRevisions = await sharedRevisions();
  const app = new Hono();
  app.use("*", protect(facetAuth, { db }));
  app.route("/", graphSignalsRoute({ db, store: {} as ObjectStore, auth: facetAuth, discarded: createDiscardedSignalsReader(db) }));
  const aliceCookie = await facetCookie(alice.sub);
  const bobCookie = await facetCookie(bob.sub);
  const get = async (path: string, cookie = aliceCookie) => {
    const response = await app.request(`/api/graph-signals/${path}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    return response.json();
  };
  const cityCounts = async (query = "", cookie = aliceCookie) => {
    const body = await get(`by-city${query}`, cookie);
    return body.cities.find((city: { citySlug: string }) => city.citySlug === target.citySlug);
  };
  const baseline = await get(target.citySlug);
  const counts = await cityCounts();
  expect(await get(`${target.citySlug}?showDiscarded=1`)).toEqual(baseline);
  expect(await cityCounts("?showDiscarded=1")).toEqual(counts);
  await writeFacet(db, alice.sub, { action: "discard", target, reasonCode: "V2-PRECEDENT", expectedHeadId: null, commandKey: randomUUID() });
  // Human history adds a shared, redacted provenance marker, even with no AI writes.
  const manuallyAnnotated = { ...baseline, nodes: baseline.nodes.map((node: { id: string }) =>
    node.id === target.id ? { ...node, classAnnotation: {
      citySlug: target.citySlug, nodeType: target.type, nodeId: target.id,
      classe: "non_classe", source: "manual", reason: "", model: null, effort: null,
      promptId: null, promptSha256: null, pipelineRunId: null, inputSha256: null,
    } } : node) };
  const hidden = await get(target.citySlug);
  expect(hidden.nodes.map((node: { id: string }) => node.id)).toEqual([keep.id]);
  expect((await cityCounts()).signalCount).toBe(1);
  expect(await get(`${target.citySlug}?showDiscarded=1`)).toEqual(manuallyAnnotated);
  expect(await cityCounts("?showDiscarded=1")).toEqual(counts);
  expect(await get(target.citySlug, bobCookie)).toEqual(manuallyAnnotated);
  expect(await cityCounts("", bobCookie)).toEqual(counts);
  await refresh([original, keep]);
  expect(await sourceRevisions()).toEqual(initialSourceRevisions);
  expect(await get(`${target.citySlug}?showDiscarded=1`)).toEqual(manuallyAnnotated);
  expect((await get(target.citySlug)).nodes.map((node: { id: string }) => node.id)).toEqual([keep.id]);
  expect((await readCityFacets(db, alice.sub, target.citySlug))[0]?.changedSinceArchive).toBe(false);
  await refresh([{ ...original, community: 7, community_name: "Synthetic community" }, keep]);
  expect(await sourceRevisions()).toEqual(initialSourceRevisions);
  expect((await readCityFacets(db, alice.sub, target.citySlug))[0]?.changedSinceArchive).toBe(false);
  const changed = { ...original, label: "Changed synthetic content" };
  await refresh([changed, keep]);
  expect((await get(target.citySlug)).nodes.map((node: { id: string }) => node.id)).toEqual([keep.id]);
  expect((await readCityFacets(db, alice.sub, target.citySlug))[0]?.changedSinceArchive).toBe(true);
  await refresh([keep], [target.id]);
  expect((await readCityFacets(db, alice.sub, target.citySlug))[0]).toMatchObject({ targetAvailable: false, changedSinceArchive: null });
  expect(await db.select().from(facetEvents).where(eq(facetEvents.ownerId, alice.ownerId))).toHaveLength(1);
  await refresh([original, keep]);
  expect((await get(target.citySlug)).nodes.map((node: { id: string }) => node.id)).toEqual([keep.id]);
  await refresh([{ ...original, id: "renumbered-id" }, keep], [target.id]);
  expect((await get(target.citySlug)).nodes.map((node: { id: string }) => node.id).sort()).toEqual([keep.id, "renumbered-id"].sort());
  expect((await cityCounts()).signalCount).toBe(2);
  expect((await readCityFacets(db, alice.sub, target.citySlug))[0]?.targetAvailable).toBe(false);
  expect(await sharedRevisions()).toEqual(initialSharedRevisions);
  const annotations = await db.execute(sql`SELECT node_id FROM signal_class_annotations
    WHERE city_slug = ${target.citySlug}`);
  expect(annotations.rows).toEqual([]);
});
