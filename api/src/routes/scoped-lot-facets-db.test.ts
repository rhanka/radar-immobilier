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
    expect(original.result).toMatchObject({ target: single.target, mode: "real" });
    expect(original.result.events[0]).toMatchObject({ facet: "pipeline", state: "active" });
    expect(original.result.heads).toHaveLength(1);
    expect(original.result.heads[0].displayedVersion).toEqual(resolved.displayed);
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

  it("should return full results and exact replays for composite and unchanged commands", async () => {
    const f = await lotFixture();
    const moderator: { sub: string; via?: string } = { sub: f.moderator.sub };
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, moderator as never); await next(); });
    app.route("/", scopedLotFacetsRoute({ db: f.db, auth: { enabled: true } }));
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets`;
    const resolved = await resolveLotSource(f.db,
      { citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" });
    const target = { type: "Lot", authority: "lot_versions",
      citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" };
    const selected = await app.request(`${base}/workspace/commands`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ mode: "real", target,
        displayed_version: resolved.displayed, expected_head_id: null,
        mutation: { action: "select", basket_id: f.selectionBasket } }) });
    const selectedBody = await selected.json() as {
      result: { events: Array<{ id: string }>; heads: Array<{ id: string }> } };
    const key = randomUUID();
    const composite = await app.request(`${base}/workspace/commands`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ mode: "real", target,
        displayed_version: resolved.displayed, expected_head_id: null,
        mutation: { action: "discard", reasonCode: "N-NON-RES",
          deselect: [{ basket_id: f.selectionBasket,
            expected_head_id: selectedBody.result.heads[0]!.id }] } }) });
    expect(composite.status).toBe(200);
    const compositeBody = await composite.json() as {
      result: {
        target: unknown; mode: string;
        events: Array<{ facet: string; state: string; id: string }>;
        heads: Array<{ id: string }>;
      } };
    expect(compositeBody.result).toMatchObject({ target, mode: "real" });
    expect(compositeBody.result.events.map((event) => [event.facet, event.state]))
      .toEqual([["archive", "active"], ["selection", "inactive"]]);
    expect(compositeBody.result.heads.map((head) => head.id).sort()).toEqual(
      compositeBody.result.events.map((event) => event.id).sort());
    const replayed = await app.request(`${base}/workspace/commands`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ mode: "real", target,
        displayed_version: resolved.displayed, expected_head_id: null,
        mutation: { action: "discard", reasonCode: "N-NON-RES",
          deselect: [{ basket_id: f.selectionBasket,
            expected_head_id: selectedBody.result.heads[0]!.id }] } }) });
    expect(await replayed.json()).toEqual(compositeBody);
    const archiveHeadId = compositeBody.result.events
      .find((event) => event.facet === "archive")!.id;
    const retiredHeadId = compositeBody.result.events
      .find((event) => event.facet === "selection")!.id;
    const noopKey = randomUUID();
    const noopRequest = { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": noopKey },
      body: JSON.stringify({ mode: "real", target,
        displayed_version: resolved.displayed, expected_head_id: archiveHeadId,
        mutation: { action: "discard", reasonCode: "N-NON-RES",
          deselect: [{ basket_id: f.selectionBasket,
            expected_head_id: retiredHeadId }] } }) };
    const noop = await app.request(`${base}/workspace/commands`, noopRequest);
    expect(noop.status).toBe(200);
    const noopBody = await noop.json() as {
      result: { events: unknown[]; heads: Array<{ id: string }> } };
    expect(noopBody.result.events).toEqual([]);
    expect.soft(noopBody.result.heads.map((head) => head.id))
      .toEqual([archiveHeadId, retiredHeadId]);
    const noopReplay = await app.request(`${base}/workspace/commands`, noopRequest);
    expect(noopReplay.status).toBe(200);
    expect(await noopReplay.json()).toEqual(noopBody);
    const noopBatchRequest = { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ mode: "real", items: [{ target,
        displayed_version: resolved.displayed, expected_head_id: archiveHeadId,
        mutation: { action: "discard", reasonCode: "N-NON-RES",
          deselect: [{ basket_id: f.selectionBasket, expected_head_id: retiredHeadId }] } }] }) };
    const noopBatch = await app.request(`${base}/workspace/commands/batch`, noopBatchRequest);
    expect(noopBatch.status).toBe(200);
    const noopBatchBody = await noopBatch.json() as {
      result: { items: Array<{ events: unknown[]; heads: Array<{ id: string }> }> } };
    expect(noopBatchBody.result).toMatchObject({
      targets: 1, changed: 0, unchanged: 1, eventsAppended: 0 });
    expect(noopBatchBody.result.items[0]!.events).toEqual([]);
    expect.soft(noopBatchBody.result.items[0]!.heads.map((head) => head.id))
      .toEqual([archiveHeadId, retiredHeadId]);
    const noopBatchReplay = await app.request(
      `${base}/workspace/commands/batch`, noopBatchRequest);
    expect(noopBatchReplay.status).toBe(200);
    expect(await noopBatchReplay.json()).toEqual(noopBatchBody);
  });

  it("should return 422 for a missing discard reason on both command routes", async () => {
    const f = await lotFixture();
    const session: { sub: string; via?: string } = { sub: f.moderator.sub };
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
    app.route("/", scopedLotFacetsRoute({ db: f.db, auth: { enabled: true } }));
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets`;
    const resolved = await resolveLotSource(f.db,
      { citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" });
    const item = { target: { type: "Lot", authority: "lot_versions",
      citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" },
    displayed_version: resolved.displayed, expected_head_id: null,
    mutation: { action: "discard" } };
    const single = await app.request(`${base}/workspace/commands`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ mode: "real", ...item }) });
    expect.soft(single.status).toBe(422);
    const batch = await app.request(`${base}/workspace/commands/batch`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ mode: "real", items: [item] }) });
    expect(batch.status).toBe(422);
  });
});
