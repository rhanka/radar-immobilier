import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { graphNodes } from "../../src/db/schema.js";
import { describeDb, revisionFixture, revisionCitySignal } from "../../src/services/facets/projection-revisions-fixture.js";
import { scopedProjectionRevisionsRoute } from "../../src/routes/scoped-projection-revisions.js";
import { scopedWorkspaceArchiveRoute } from "../../src/routes/scoped-workspace-archive.js";
import { scopedSignalFacetsRoute } from "../../src/routes/scoped-signal-facets.js";

async function fixture() {
  const f = await revisionFixture();
  const { target, fingerprint } = await revisionCitySignal(f);
  let sub = f.moderator.sub;
  let via = "cookie";
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("session" as never, { sub, via } as never); await next(); });
  const deps = { db: f.db, auth: { enabled: true } };
  app.route("/", scopedProjectionRevisionsRoute(deps));
  app.route("/", scopedWorkspaceArchiveRoute(deps));
  app.route("/", scopedSignalFacetsRoute(deps));
  const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets`;
  const post = (path: string, body: object, key = randomUUID()) => app.request(`${base}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ target, displayedFingerprint: fingerprint, ...body }),
  });
  const archives: Record<string, string> = {};
  for (const scope of ["personal", "workspace"]) {
    const response = await post(`${scope}/discard`, { expectedHeadId: null, reasonCode: "N-NON-RES" });
    expect(response.status).toBe(200);
    archives[scope] = (await response.json()).event.id;
  }
  const body = { archives, selectionHeads: { pertinent: null, a_surveiller: null }, nextClass: "non_classe" };
  const read = async () => (await app.request(`${base}/coherent-city?citySlug=${target.citySlug}&mode=signal&showDiscarded=1`)).json();
  return { ...f, target, app, base, post, body, read,
    actor: (value: string, transport = "cookie") => { sub = value; via = transport; } };
}

describeDb("atomic archive restoration", () => {
  it("should roll back personal restoration when the workspace head conflicts", async () => {
    const f = await fixture();
    const before = await f.read();
    const response = await f.post("personal/reclassify", { ...f.body,
      archives: { ...f.body.archives, workspace: randomUUID() } });
    expect(response.status).toBe(409);
    expect((await f.read()).heads[0]).toMatchObject({ personal: { state: "active" }, workspace: { state: "active" } });
    expect((await f.read()).token).toBe(before.token);
  });

  it("should leave both archives active after a concurrent graph refresh", async () => {
    const f = await fixture();
    await f.db.update(graphNodes).set({ label: "Concurrent refresh" }).where(eq(graphNodes.id, f.target.id));
    const response = await f.post("personal/reclassify", f.body);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "target_version_conflict" });
    expect((await f.read()).heads[0]).toMatchObject({ personal: { state: "active" }, workspace: { state: "active" } });
  });

  for (const invalid of ["head", "reason"] as const) it(`should roll back both restorations on selection ${invalid} failure`, async () => {
    const f = await fixture();
    const before = await f.read();
    const response = await f.post("personal/reclassify", { ...f.body, nextClass: "pertinent",
      ...(invalid === "reason" ? { reasonCode: "N-NON-RES" }
        : { selectionHeads: { pertinent: randomUUID(), a_surveiller: null } }) });
    expect(response.status).toBe(invalid === "reason" ? 422 : 409);
    expect((await f.read()).heads[0]).toMatchObject({ personal: { state: "active" }, workspace: { state: "active" } });
    expect((await f.read()).token).toBe(before.token);
  });

  it("should recover a lost committed response with the same key even after graph refresh", async () => {
    const f = await fixture();
    const key = randomUUID();
    expect((await f.post("personal/reclassify", f.body, key)).status).toBe(200);
    const committed = await f.read();
    expect(committed.heads[0]).toMatchObject({ personal: { state: "inactive" }, workspace: { state: "inactive" } });
    await f.db.update(graphNodes).set({ label: "Refresh after commit" }).where(eq(graphNodes.id, f.target.id));
    expect((await f.post("personal/reclassify", f.body, key)).status).toBe(200);
    const replayed = await f.read();
    expect(replayed.heads).toEqual(committed.heads);
    expect(replayed.token).toBe(committed.token);
    expect((await f.post("personal/reclassify", { ...f.body, nextClass: "pertinent" }, key)).status).toBe(409);
    f.actor(f.contributor.sub);
    expect((await f.app.request(`${f.base}/coherent-city?citySlug=${f.target.citySlug}&mode=signal`)).status).toBe(200);
  });

  it("should preserve moderation and browser-session guards before any mutation", async () => {
    const f = await fixture();
    for (const [sub, via] of [[f.contributor.sub, "cookie"], [f.moderator.sub, "bearer"]]) {
      f.actor(sub!, via);
      expect((await f.post("personal/reclassify", f.body)).status).toBe(403);
    }
    f.actor(f.moderator.sub);
    expect((await f.read()).heads[0]).toMatchObject({ personal: { state: "active" }, workspace: { state: "active" } });
  });
});
