// 6J scoped lot routes: session, bearer, and contract gating.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { resolveLotSource } from "../services/facets/lots/lot-target.js";
import { describeDb, lotFixture } from "../services/facets/lots/lot-fixture.js";
import { scopedLotFacetsRoute } from "./scoped-lot-facets.js";

describeDb("6J scoped lot HTTP contract", () => {
  it("should gate reads and writes on session, transport, and destination", async () => {
    const f = await lotFixture();
    let session: { sub: string; via?: string } | null = null;
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
    app.route("/", scopedLotFacetsRoute({ db: f.db, auth: { enabled: true } }));
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets`;
    expect((await app.request(`${base}?citySlug=synthetic-6j-city&canonicalId=x&mode=real`)).status)
      .toBe(401);
    session = { sub: f.contributor.sub };
    const closed = await app.request(
      `/api/v1/workspaces/${f.otherId}/lot-facets?citySlug=synthetic-6j-city&canonicalId=x&mode=real`);
    expect(closed.status).toBe(503);
    expect(closed.headers.get("cache-control")).toBe("private, no-store");
    const resolved = await resolveLotSource(f.db,
      { citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" });
    const body = { mode: "real",
      target: { type: "Lot", authority: "lot_versions",
        citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" },
      displayed_version: resolved.displayed,
      expected_head_id: null,
      mutation: { action: "select", basket_id: f.selectionBasket } };
    session = { sub: f.contributor.sub, via: "bearer" };
    expect((await app.request(`${base}/workspace/commands`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify(body) })).status).toBe(403);
    session = { sub: f.contributor.sub };
    expect((await app.request(`${base}/workspace/commands`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body) })).status).toBe(400);
    expect((await app.request(`${base}/workspace/commands`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "not-a-uuid" },
      body: JSON.stringify(body) })).status).toBe(400);
  });

  it("should write and read lot facets over HTTP without mounting in app.ts", async () => {
    const f = await lotFixture();
    const session: { sub: string; via?: string } = { sub: f.contributor.sub };
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
    app.route("/", scopedLotFacetsRoute({ db: f.db, auth: { enabled: true } }));
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets`;
    const resolved = await resolveLotSource(f.db,
      { citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" });
    const single = { mode: "real",
      target: { type: "Lot", authority: "lot_versions",
        citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" },
      displayed_version: resolved.displayed,
      expected_head_id: null,
      mutation: { action: "set_pipeline", status: "sollicite" } };
    const key = randomUUID();
    const created = await app.request(`${base}/workspace/commands`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(single) });
    expect(created.status).toBe(200);
    const original = await created.json();
    expect(original.result).toMatchObject({ facet: "pipeline", state: "active" });
    const replayed = await app.request(`${base}/workspace/commands`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(single) });
    expect(await replayed.json()).toEqual(original);
    const read = await app.request(
      `${base}?citySlug=synthetic-6j-city&canonicalId=lot-canonical-syn-6j-01&mode=real`);
    expect(read.status).toBe(200);
    const state = await read.json() as { pipeline: { pipelineStatus: string } | null };
    expect(state.pipeline?.pipelineStatus).toBe("sollicite");
    const personal = await app.request(`${base}/personal/commands`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify(single) });
    expect(personal.status).toBe(400);
    const resolvedSecond = await resolveLotSource(f.db,
      { citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-02" });
    const batchItem = {
      target: { type: "Lot", authority: "lot_versions",
        citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-02" },
      displayed_version: resolvedSecond.displayed,
      expected_head_id: null,
      mutation: { action: "select", basket_id: f.selectionBasket } };
    const batch = await app.request(`${base}/workspace/commands/batch`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ mode: "real", items: [batchItem] }) });
    expect(batch.status).toBe(200);
    const batchResult = await batch.json() as { result: { targets: number; changed: number } };
    expect(batchResult.result).toMatchObject({ targets: 1, changed: 1 });
  });
});
