import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { facetCommands, facetEvents, graphNodes } from "../db/schema.js";
import { scopedSignalFacetsRoute } from "./scoped-signal-facets.js";
import { activation, attach, describeDb, fixture, safety } from "../services/facets/scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "../services/facets/activation-run.js";
import { targetFingerprint } from "../services/facets/target.js";
import { historicalCommandDigest } from "../services/facets/commands.js";
import { facetEventResponse } from "../services/facets/response.js";

describeDb("6H scoped HTTP contract", () => {
  it("should protect reads and writes with private caching, current authorization and 409 heads", async () => {
    const f = await fixture();
    let session: { sub: string; via?: string } | null = null;
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
    app.route("/", scopedSignalFacetsRoute({ db: f.db, auth: { enabled: true } }));
    const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets/personal`;
    const get = () => app.request(`${base}/cities/synthetic-city`);
    expect((await get()).status).toBe(401);
    session = { sub: f.member.sub };
    const closed = await get();
    expect(closed.status).toBe(503);
    expect(closed.headers.get("cache-control")).toBe("private, no-store");
    await attach(f);
    await runPersonalAttachmentActivation(f.db, activation(f), safety);
    const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
      citySlug: "synthetic-city", label: "Synthetic HTTP signal" }).returning();
    const body = { target: { citySlug: node!.citySlug, type: "Signal", id: node!.id },
      basket: "pertinent", expectedHeadId: null, displayedFingerprint: targetFingerprint(node!) };
    const post = (key = randomUUID()) => app.request(`${base}/select`, {
      method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    session = { sub: f.member.sub, via: "bearer" };
    expect((await post()).status).toBe(403);
    session = { sub: f.member.sub };
    const key = randomUUID();
    const result = await post(key);
    expect(result.status).toBe(200);
    const original = await result.json();
    expect(await (await post(key)).json()).toEqual(original);
    const conflict = await post();
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: "facet_head_conflict",
      current: { heads: [expect.objectContaining({ id: original.event.id })] } });
    session = { sub: f.actor.sub };
    expect(await (await get()).json()).toEqual({ ok: true, heads: [] });
    session = { sub: "synthetic-unknown" };
    expect((await get()).status).toBe(403);
  });

  it.each(["pre-6A", "6A"] as const)("should recover a qualified %s receipt over HTTP without creating a new command", async (kind) => {
    const f = await fixture();
    const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
      citySlug: "synthetic-city", label: "Synthetic HTTP historical signal" }).returning();
    const target = { citySlug: node!.citySlug, type: "Signal" as const, id: node!.id };
    const key = randomUUID();
    const body = { target, basket: "pertinent" as const,
      ...(kind === "6A" ? { expectedHeadId: null } : {}) };
    const commandDigest = historicalCommandDigest({ ...body, action: "select", commandKey: key });
    const [row] = await f.db.insert(facetEvents).values({ ownerId: f.member.id, actorId: f.member.id,
      citySlug: target.citySlug, nodeType: target.type, nodeId: target.id, facet: "selection",
      basket: "pertinent", state: "active", observedFingerprint: targetFingerprint(node!),
      commandKey: key, commandDigest }).returning();
    const snapshot = { ...row!, createdAt: row!.createdAt.toISOString() };
    await f.db.insert(facetCommands).values({ ownerId: f.member.id, commandKey: key, commandDigest,
      result: { event: snapshot, ...(kind === "6A" ? { context: {
        target, facet: "selection", basket: "pertinent", expectedHeadId: null,
        expectedSelectionHeads: null } } : {}) } });
    await attach(f);
    await runPersonalAttachmentActivation(f.db, activation(f), safety);
    const session: { sub: string; via?: string } = { sub: f.member.sub };
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
    app.route("/", scopedSignalFacetsRoute({ db: f.db, auth: { enabled: true } }));
    const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets/personal`;
    const before = (await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n;
    const post = (commandKey: string, payload = body) => app.request(`${base}/select`, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": commandKey },
      body: JSON.stringify(payload) });
    const recovered = await post(key);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ ok: true, event: facetEventResponse(snapshot) });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n).toBe(before);
    const unknown = await post(randomUUID());
    expect(unknown.status).toBe(400);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_commands")).rows[0].n).toBe(1);
    await f.pool.query("DELETE FROM graph_nodes WHERE id = $1", [node!.id]);
    expect(await (await post(key)).json()).toEqual({ ok: true, event: facetEventResponse(snapshot) });
    await f.pool.query("UPDATE workspace_memberships SET status = 'revoked', revoked_at = now() WHERE workspace_id = $1 AND account_id = $2",
      [f.workspaceId, f.member.id]);
    expect((await post(key)).status).toBe(403);
  });
});
