import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { buildClassementMap } from "../../../ui/src/lib/signals/signal-classement.js";
import { describeDb, revisionFixture, revisionCitySignal } from "../../src/services/facets/projection-revisions-fixture.js";
import { scopedProjectionRevisionsRoute } from "../../src/routes/scoped-projection-revisions.js";
import { scopedWorkspaceArchiveRoute } from "../../src/routes/scoped-workspace-archive.js";
import { scopedSignalFacetsRoute } from "../../src/routes/scoped-signal-facets.js";

describeDb("classement restoration scopes over PostgreSQL", () => {
  for (const both of [false, true]) it(`should restore shared archives with personal archive=${both}`, async () => {
    const f = await revisionFixture();
    const { target, fingerprint } = await revisionCitySignal(f);
    let sub = f.moderator.sub;
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, { sub } as never); await next(); });
    const deps = { db: f.db, auth: { enabled: true } };
    app.route("/", scopedProjectionRevisionsRoute(deps));
    app.route("/", scopedWorkspaceArchiveRoute(deps));
    app.route("/", scopedSignalFacetsRoute(deps));
    const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets`;
    const post = (path: string, body: object) => app.request(`${base}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ target, displayedFingerprint: fingerprint, ...body }),
    });
    expect((await post("workspace/discard", { expectedHeadId: null, reasonCode: "N-NON-RES" })).status).toBe(200);
    if (both) expect((await post("personal/discard", { expectedHeadId: null, reasonCode: "N-NON-RES" })).status).toBe(200);
    const url = `${base}/coherent-city?citySlug=${target.citySlug}&mode=signal`;
    const read = async (shown = false) => (await app.request(url + (shown ? "&showDiscarded=1" : ""))).json();
    expect((await read()).signals).toHaveLength(0);
    const shown = await read(true);
    expect(shown.signals).toMatchObject([{ id: target.id, facetFingerprint: fingerprint }]);
    const entry = buildClassementMap(shown.selection, shown.heads).values().next().value!;
    sub = f.contributor.sub;
    const refused = await post("workspace/restore", { expectedHeadId: shown.heads[0].workspace.id });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "workspace_capability_required" });
    expect((await read()).signals).toHaveLength(0);
    sub = f.moderator.sub;
    // Use the same scoped archive identities consumed by the card client.
    expect(entry.archiveRestores).toHaveLength(both ? 2 : 1);
    for (const archive of entry.archiveRestores) {
      expect((await post(`${archive.scope}/restore`, { expectedHeadId: archive.id })).status).toBe(200);
    }
    expect((await read()).signals).toMatchObject([{ id: target.id }]);
    expect((await read()).counts.hidden).toBe(0);
    expect((await read()).heads.every((head: { effectiveDiscarded: boolean }) => !head.effectiveDiscarded)).toBe(true);
  });
});
