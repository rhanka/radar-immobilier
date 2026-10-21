import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { graphNodes } from "../db/schema.js";
import { scopedSignalFacetsRoute } from "./scoped-signal-facets.js";
import { activation, attach, describeDb, fixture, safety } from "../services/facets/scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "../services/facets/activation-run.js";
import { targetFingerprint } from "../services/facets/target.js";

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
});
