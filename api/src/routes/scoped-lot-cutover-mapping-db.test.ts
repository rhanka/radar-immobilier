import { expect, it } from "vitest";
import { Hono } from "hono";
import { cutoverFixture, describeDb } from "../services/facets/lots/cutover-fixture.js";
import { scopedLotCutoverRoute } from "./scoped-lot-cutover.js";
import { MAPPING, makeCutoverApp, seedLegacyChain } from "./scoped-lot-cutover-harness.js";

describeDb("6K operator-qualified mapping", () => {
  it("should reject client qualification without a configured destination mapping", async () => {
    const f = await cutoverFixture();
    await seedLegacyChain(f, f.moderator.id);
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, { sub: f.moderator.sub } as never); await next(); });
    app.route("/", scopedLotCutoverRoute({ db: f.db, auth: { enabled: true } }));
    const request = { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapping: MAPPING }) };
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets`;
    expect((await app.request(`${base}/cutover/evaluate`, request)).status).toBe(503);
    const configured = makeCutoverApp(f, { sub: f.moderator.sub });
    expect((await configured.request(`${base}?citySlug=synthetic-6j-city&canonicalId=lot-canonical-syn-6j-01&mode=real`))
      .status).toBe(503);
    const drift = await configured.request(`${base}/cutover/evaluate`, { ...request,
      body: JSON.stringify({ mapping: { ...MAPPING, mappingVersion: "unqualified-client-version" } }) });
    expect(drift.status).toBe(409);
    expect(await drift.json()).toMatchObject({ error: "lot_mapping_drift" });
  });
});
