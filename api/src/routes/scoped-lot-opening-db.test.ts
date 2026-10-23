// Exercise the public router with populated histories and stored receipts.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { lotCutoverState } from "../db/schema.js";
import { cutoverFixture, cleanCutoverReport, describeDb,
  recordingCutoverSafety } from "../services/facets/lots/cutover-fixture.js";
import { runLotCutover } from "../services/facets/lots/lot-cutover.js";
import { displayedFor } from "../services/facets/lots/lot-test-helpers.js";
import { scopedLotFacetsRoute } from "./scoped-lot-facets.js";

describeDb("B2 public lot opening", () => {
  it("should close populated reads, stored receipts and public readback options", async () => {
    const f = await cutoverFixture();
    const { report } = cleanCutoverReport();
    await runLotCutover(f.db, { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
      report, importKey: randomUUID(), confirmCutover: true,
      recomputeManifest: async () => report }, recordingCutoverSafety().safety);
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("session" as never, { sub: f.contributor.sub } as never); await next();
    });
    app.route("/", scopedLotFacetsRoute({ db: f.db, auth: { enabled: true } }));
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets`;
    const shown = await displayedFor(f);
    const item = { target: shown.target, displayed_version: shown.displayed,
      expected_head_id: null, mutation: { action: "set_pipeline", status: "sollicite" } };
    const requests = [
      { path: `${base}/workspace/commands`, key: randomUUID(), body: { mode: "real", ...item } },
      { path: `${base}/workspace/commands/batch`, key: randomUUID(),
        body: { mode: "real", items: [{ ...item,
          mutation: { action: "select", basket_id: f.selectionBasket } }] } },
    ];
    const post = (request: typeof requests[number]) => app.request(request.path, { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": request.key },
      body: JSON.stringify(request.body) });
    for (const request of requests) {
      const created = await post(request);
      expect(created.status).toBe(200);
      expect(await (await post(request)).text()).toBe(await created.text());
    }
    const query = `citySlug=${shown.target.citySlug}&canonicalId=${shown.target.canonicalId}&mode=real`;
    const reads = [`${base}?${query}`, `${base}/heads?${query}`, `${base}/history?${query}`,
      `${base}/source-history?chainId=${encodeURIComponent(report.rows[0]!.chainId)}`];
    for (const path of reads) expect((await app.request(path)).status).toBe(200);
    await f.db.update(lotCutoverState).set({ destinationOpen: false })
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    for (const path of [...reads, `${reads[1]}&internal=true&readback=true&allowClosed=true`]) {
      const response = await app.request(path);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ error: `lot_destination_disabled:${f.workspaceId}` });
    }
    for (const request of requests) expect((await post(request)).status).toBe(503);
  });
});
