import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { graphNodes } from "../db/schema.js";
import { writeScopedPersonalFacet } from "../services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../services/facets/workspace-writer.js";
import { scopedProjectionRevisionsRoute } from "./scoped-projection-revisions.js";
import { describeDb, fixture } from "../services/facets/scope-db-fixture.js";
import {
  revisionCitySignal,
  revisionFixture,
} from "../services/facets/projection-revisions-fixture.js";
import type { Database } from "../db/client.js";

function appFor(f: { db: Database; workspaceId: string }, session: { sub: string } | null) {
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
  app.route("/", scopedProjectionRevisionsRoute({ db: f.db, auth: { enabled: true } }));
  return app;
}

describeDb("6L1 projection revision HTTP contract", () => {
  it("should guard revision reads and reload a coherent city", async () => {
    const f = await revisionFixture();
    const { target, fingerprint } = await revisionCitySignal(f);
    const base = `/api/v1/workspaces/${f.workspaceId}/signal-facets`;
    const anonymous = appFor(f, null);
    const tokenUrl = `${base}/projection-revisions?citySlug=${target.citySlug}&mode=signal`;
    expect((await anonymous.request(tokenUrl)).status).toBe(401);
    const outsider = appFor(f, { sub: f.outsider.sub });
    expect((await outsider.request(tokenUrl)).status).toBe(403);
    const member = appFor(f, { sub: f.contributor.sub });
    expect((await member.request(`${base}/projection-revisions?citySlug=bad_city&mode=signal`)).status).toBe(400);
    expect((await member.request(`${base}/projection-revisions?citySlug=${target.citySlug}&mode=lot`)).status).toBe(400);
    const tokenRes = await member.request(tokenUrl);
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.headers.get("cache-control")).toBe("private, no-store");
    const before = await tokenRes.json() as { token: string };
    const fresh = await member.request(`${base}/coherent-city?citySlug=${target.citySlug}&mode=signal`);
    const freshCity = await fresh.json() as { signals: Array<{ id: string; label: string }>;
      counts: { total: number; hidden: number; visible: number; selected: number } };
    expect(freshCity.counts).toEqual({ total: 1, hidden: 0, visible: 1, selected: 0 });
    expect(freshCity.signals).toMatchObject([{ id: target.id, label: "Synthetic 6L1 signal" }]);
    const privateArchive = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const own = await (await member.request(`${base}/coherent-city?citySlug=${target.citySlug}&mode=signal`)).json() as {
      signals: unknown[]; selection: unknown[]; counts: { selected: number };
    };
    expect(own.signals).toEqual([]);
    expect(own.selection).toEqual([]);
    expect(own.counts.selected).toBe(0);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: privateArchive!.id,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const cityRes = await member.request(`${base}/coherent-city?citySlug=${target.citySlug}&mode=signal`);
    expect(cityRes.status).toBe(200);
    const city = await cityRes.json() as { token: string; heads: unknown[]; selection: unknown[];
      counts: { total: number; hidden: number; visible: number; selected: number } };
    expect(city.token).not.toBe(before.token);
    expect(city.counts).toEqual({ total: 1, hidden: 1, visible: 0, selected: 0 });
    expect(city.heads).toHaveLength(1);
    expect(city.selection).toHaveLength(0);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "select", target, basket: "pertinent", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const reselected = await member.request(`${base}/coherent-city?citySlug=${target.citySlug}&mode=signal`);
    const reselectedCity = await reselected.json() as typeof city;
    expect(reselectedCity.token).not.toBe(city.token);
    expect(reselectedCity.counts).toEqual({ total: 1, hidden: 1, visible: 0, selected: 1 });
    expect(reselectedCity.selection).toHaveLength(1);
  });

  it("should stay unavailable before the scope is activated", async () => {
    const f = await fixture();
    await f.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
      citySlug: "synthetic-city", label: "Synthetic 6L1 legacy signal" });
    const app = new Hono();
    const session: { sub: string } | null = { sub: f.member.sub };
    app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
    app.route("/", scopedProjectionRevisionsRoute({ db: f.db, auth: { enabled: true } }));
    const url = `/api/v1/workspaces/${f.workspaceId}/signal-facets/projection-revisions?citySlug=synthetic-city&mode=signal`;
    const closed = await app.request(url);
    expect(closed.status).toBe(503);
    expect(closed.headers.get("cache-control")).toBe("private, no-store");
  });
});
