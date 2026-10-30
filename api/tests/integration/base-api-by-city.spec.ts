// 6H scoped by-city aggregate: parity with the legacy aggregate service on
// identical synthetic data, workspace visibility, refusals and closed epoch.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { graphNodes } from "../../src/db/schema.js";
import { scopedProjectionRevisionsRoute } from "../../src/routes/scoped-projection-revisions.js";
import { listCitiesWithSignalNodes } from "../../src/services/graph/graph-store.js";
import { fixture } from "../../src/services/facets/scope-db-fixture.js";
import { describeDb, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { httpFixture } from "./base-api-http-fixture.js";

type ByCity = { ok: boolean; totalCount: number;
  cities: Array<{ citySlug: string; signalCount: number; subsetCounts: Record<string, number>;
    vivierV2Counts: unknown }> };

function countFor(body: ByCity, citySlug: string): number {
  return body.cities.find((city) => city.citySlug === citySlug)?.signalCount ?? 0;
}

describeDb("base-api scoped by-city aggregate", () => {
  it("matches the legacy aggregate service on identical data, with and without a date window", async () => {
    const f = await httpFixture();
    await workspaceSignal(f.data, "Second synthetic signal");
    await f.data.db.insert(graphNodes).values({ id: randomUUID(), type: "DesignationEvent",
      citySlug: "synthetic-other", label: "Synthetic designation",
      props: { properties: { category: "zonage", etape: "avis_motion" } } });
    const all = await f.request(f.path("by-city"));
    expect(all.status).toBe(200);
    expect(all.headers.get("cache-control")).toBe("private, no-store");
    const body = await all.json() as ByCity;
    const legacy = await listCitiesWithSignalNodes(f.data.db);
    expect(body.cities).toEqual(legacy);
    expect(body.totalCount).toBe(legacy.reduce((sum, city) => sum + city.signalCount, 0));
    expect(countFor(body, "synthetic-city")).toBe(2);
    expect(countFor(body, "synthetic-other")).toBe(1);

    const windowed = await (await f.request(f.path(
      "by-city?dateFrom=2026-01-01&dateTo=2026-12-31&excludePiia=1&excludeDerogations=1"))).json() as ByCity;
    expect(windowed.cities).toEqual(await listCitiesWithSignalNodes(f.data.db, {
      dateFrom: "2026-01-01", dateTo: "2026-12-31", excludePiia: true, excludeDerogations: true }));
  });

  it("hides effectively discarded targets for the viewer and counts them with showDiscarded=1", async () => {
    const f = await httpFixture();
    await workspaceSignal(f.data, "Kept synthetic signal");
    const body = { target: f.signal.target, displayedFingerprint: f.signal.fingerprint,
      expectedHeadId: null, reasonCode: "N-NON-RES" };
    expect((await f.command("personal", "discard", body)).status).toBe(200);
    const own = await (await f.request(f.path("by-city"))).json() as ByCity;
    expect(countFor(own, "synthetic-city")).toBe(1);
    const full = await (await f.request(f.path("by-city?showDiscarded=1"))).json() as ByCity;
    expect(countFor(full, "synthetic-city")).toBe(2);
    // A personal archive never changes another member's counters.
    const other = await (await f.request(f.path("by-city"), f.data.moderator.sub)).json() as ByCity;
    expect(countFor(other, "synthetic-city")).toBe(2);
    // The workspace archive hides the target for every member.
    expect((await f.command("workspace", "discard", body, f.data.moderator.sub)).status).toBe(200);
    const moderated = await (await f.request(f.path("by-city"), f.data.moderator.sub)).json() as ByCity;
    expect(countFor(moderated, "synthetic-city")).toBe(1);
  });

  it("refuses a non-member and malformed queries without any counter", async () => {
    const f = await httpFixture();
    const outsider = await f.request(f.path("by-city"), f.data.outsider.sub);
    expect(outsider.status).toBeGreaterThanOrEqual(400);
    expect(outsider.status).not.toBe(404);
    expect(await outsider.json()).not.toHaveProperty("cities");
    for (const query of ["dateFrom=yesterday", "showDiscarded=true", "dateBasis=other"]) {
      const invalid = await f.request(f.path(`by-city?${query}`));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "invalid_by_city_query" });
    }
  });

  it("stays unavailable (503) before the scoped epoch opens", async () => {
    const f = await fixture();
    await f.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
      citySlug: "synthetic-city", label: "Synthetic closed-epoch signal" });
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, { sub: f.member.sub } as never); await next(); });
    app.route("/", scopedProjectionRevisionsRoute({ db: f.db, auth: { enabled: true } }));
    const closed = await app.request(`/api/v1/workspaces/${f.workspaceId}/signal-facets/by-city`);
    expect(closed.status).toBe(503);
    expect(await closed.json()).not.toHaveProperty("cities");
  });
});
