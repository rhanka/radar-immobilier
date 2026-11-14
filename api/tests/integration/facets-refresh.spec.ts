import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
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
import { writeClassAnnotation } from "../../src/services/graph/class-annotations.js";

const { db, pool } = createDb(loadConfig());
afterAll(() => pool.end());
it.each(["discard", "select"] as const)("should preserve main API bytes for Alice and Bob after manual %s with flag zero", async (action) => {
  vi.stubEnv("REFRESH_SINGLE_PASS", "0");
  vi.stubEnv("REFRESH_CLASSIFY_MODE", "off");
  try {
    const alice = await facetFixture(db);
    const bob = await facetFixture(db);
    const app = new Hono();
    app.use("*", protect(facetAuth, { db }));
    app.route("/", graphSignalsRoute({ db, store: {} as ObjectStore, auth: facetAuth, discarded: createDiscardedSignalsReader(db) }));
    const cookies = await Promise.all([facetCookie(alice.sub), facetCookie(bob.sub)]);
    const get = async (cookie: string) => {
      const query = cookie === cookies[0] ? "?showDiscarded=1" : "";
      const response = await app.request(`/api/graph-signals/${alice.target.citySlug}${query}`, { headers: { cookie } });
      expect(response.status).toBe(200);
      return response.text();
    };
    // Main returns this same unannotated payload before and after personal actions.
    const baseline = await get(cookies[0]!);
    const getBob = async () => {
      const response = await app.request(`/api/graph-signals/${bob.target.citySlug}`, { headers: { cookie: cookies[1]! } });
      expect(response.status).toBe(200);
      return response.text();
    };
    const bobBaseline = await getBob();
    expect(baseline).not.toContain('"classAnnotation"');
    expect(await get(cookies[1]!)).toBe(baseline);
    await writeFacet(db, alice.sub, { action, target: alice.target,
      ...(action === "select" ? { basket: "pertinent" as const } : { reasonCode: "V2-PRECEDENT" }),
      expectedHeadId: null, commandKey: randomUUID() });
    for (const cookie of cookies) expect(await get(cookie)).toBe(baseline);
    const annotations = await db.execute(sql`SELECT node_id FROM signal_class_annotations WHERE city_slug = ${alice.target.citySlug}`);
    expect(annotations.rows).toEqual([]);
    // Simulate activation, then rollback to off without deleting AI history.
    await writeClassAnnotation(db, { citySlug: alice.target.citySlug, nodeType: alice.target.type,
      nodeId: alice.target.id, source: "ai", classe: "ecarte", reason: "AI decision", ambiguous: false,
      model: "test", effort: "low", promptId: "v2", promptSha256: "a".repeat(64),
      inputSha256: "b".repeat(64), pipelineRunId: "prior-run" });
    // The manual act is protected; put a second AI-only annotation on Bob's act.
    await writeClassAnnotation(db, { citySlug: bob.target.citySlug, nodeType: bob.target.type,
      nodeId: bob.target.id, source: "ai", classe: "ecarte", reason: "AI decision", ambiguous: false,
      model: "test", effort: "low", promptId: "v2", promptSha256: "a".repeat(64),
      inputSha256: "b".repeat(64), pipelineRunId: "prior-run" });
    expect(await getBob()).toBe(bobBaseline);
    for (const cookie of cookies) expect(await get(cookie)).toBe(baseline);
  } finally {
    vi.unstubAllEnvs();
  }
});
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
  const hidden = await get(target.citySlug);
  expect(hidden.nodes.map((node: { id: string }) => node.id)).toEqual([keep.id]);
  expect((await cityCounts()).signalCount).toBe(1);
  expect(await get(`${target.citySlug}?showDiscarded=1`)).toEqual(baseline);
  expect(await cityCounts("?showDiscarded=1")).toEqual(counts);
  expect(await get(target.citySlug, bobCookie)).toEqual(baseline);
  expect(await cityCounts("", bobCookie)).toEqual(counts);
  await refresh([original, keep]);
  expect(await sourceRevisions()).toEqual(initialSourceRevisions);
  expect(await get(`${target.citySlug}?showDiscarded=1`)).toEqual(baseline);
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
