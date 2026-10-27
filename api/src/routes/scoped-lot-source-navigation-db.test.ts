import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { describeDb, lotFixture } from "../services/facets/lots/lot-fixture.js";
import { runLotImport } from "../services/facets/lots/lot-importer.js";
import { qualifiedLotReport } from "../services/facets/lots/lot-import-input.js";
import type { LotEventSnapshot } from "../services/facets/lots/lot-response.js";
import { scopedLotFacetsRoute } from "./scoped-lot-facets.js";

describeDb("6J source navigation over HTTP", () => {
  it("should reach source history and return to the destination using public responses", async () => {
    const f = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
      report: qualifiedLotReport(), importKey: randomUUID() }, { enabled: true });
    let session = { sub: f.contributor.sub };
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, session as never); await next(); });
    app.route("/", scopedLotFacetsRoute({ db: f.db, auth: { enabled: true } }));
    const base = `/api/v1/workspaces/${f.workspaceId}/lot-facets`;
    const query = "citySlug=synthetic-6j-city&canonicalId=lot-canonical-syn-6j-01&mode=real";
    const read = await app.request(`${base}?${query}`);
    expect(read.status).toBe(200);
    const state = await read.json() as { archive: { workspace: LotEventSnapshot } };
    const source = state.archive.workspace.source!;
    expect(source.sourceRowId).toBe("mark-6j-0003");
    expect(source.sourceChainId).toEqual(expect.any(String));
    const sourceQuery = `chainId=${encodeURIComponent(source.sourceChainId!)}`;
    const response = await app.request(`${base}/source-history?${sourceQuery}`);
    expect(response.status).toBe(200);
    const chain = await response.json() as {
      target: { citySlug: string; canonicalId: string }; mode: string;
      rows: Array<{ sourceId: string }>;
    };
    expect(chain.rows.map((row) => row.sourceId)).toEqual([
      "mark-6j-0001", "mark-6j-0002", "mark-6j-0003",
    ]);
    const backQuery = new URLSearchParams({ ...chain.target, mode: chain.mode });
    const history = await app.request(`${base}/history?${backQuery}`);
    expect(history.status).toBe(200);
    const destination = await history.json() as { events: LotEventSnapshot[] };
    expect(destination.events.find((event) => event.id === state.archive.workspace.id)?.source)
      .toEqual(source);
    session = { sub: f.outsider.sub };
    expect((await app.request(`${base}/source-history?${sourceQuery}`)).status).toBe(403);
  });
});
