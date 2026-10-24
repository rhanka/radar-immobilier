import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as artifacts from "@radar/artifacts-host";
import { cutoverFixture, describeDb, recordingCutoverSafety } from "../../src/services/facets/lots/cutover-fixture.js";
import { qualifiedLotCutoverSafety } from "../../src/services/facets/lots/lot-cutover-safety.js";
import * as readback from "../../src/services/facets/lots/lot-cutover-readback.js";
import { runLotCutover } from "../../src/services/facets/lots/lot-cutover.js";
import { buildLotMigrationReport } from "../../src/services/facets/lot-migration-report/report.js";
import { syntheticInput, syntheticMark } from "../../src/services/facets/lot-migration-report/fixtures.js";
import { composeLotApp } from "./base-api-lot-http-fixture.js";

describeDb("b5 real cutover public readback", () => {
  afterEach(() => vi.restoreAllMocks());
  it("holds public 503 during persisted empty readback then accepts the first ordinary mark", async () => {
    const factories = [vi.spyOn(artifacts, "createArtifactsPool"),
      vi.spyOn(artifacts, "composeArtifactHost"), vi.spyOn(artifacts, "createArtifactControl")];
    const fixture = await cutoverFixture();
    const f = composeLotApp(fixture);
    const report = buildLotMigrationReport(syntheticInput([], [], "mapping-syn-empty-v1", true));
    const bound = { workspaceId: fixture.workspaceId, actorSub: fixture.moderator.sub,
      maintenanceAttemptId: randomUUID(), releaseId: "synthetic-b5-empty", instanceIds: ["synthetic-old"] };
    const proof = { completedAt: new Date().toISOString(), coveredInstanceIds: bound.instanceIds };
    const safety = qualifiedLotCutoverSafety(fixture.db, bound,
      { ...bound, reason: "synthetic empty cutover", drain: proof, shutdown: proof }, [], {
        expectedCutoverHeads: [], qualifiedEmptyManifest: true,
        emptyReadbackScope: { citySlugs: ["synthetic-6j-city"], modes: ["real"] },
      });
    const path = `${f.lotBase}/heads?citySlug=synthetic-6j-city&mode=real`;
    expect((await f.request(path, fixture.contributor.sub)).status).toBe(503);
    const before = await f.sqlSnapshot();
    const realReadback = readback.readLotCutoverReadback;
    let observed = 0;
    vi.spyOn(readback, "readLotCutoverReadback").mockImplementation(async (...args) => {
      const persisted = await realReadback(...args);
      expect(persisted.heads).toEqual([]);
      expect((await fixture.pool.query("SELECT maintenance_barrier, destination_open FROM lot_cutover_state WHERE workspace_id=$1",
        [fixture.workspaceId])).rows).toEqual([{ maintenance_barrier: true, destination_open: false }]);
      const publicRead = await f.request(path, fixture.contributor.sub);
      expect(publicRead.status).toBe(503);
      expect(await publicRead.json()).toEqual({ error: "lot_cutover_closed" });
      observed += 1;
      return persisted;
    });
    const receipt = await runLotCutover(fixture.db, { workspaceId: fixture.workspaceId,
      actorSub: fixture.moderator.sub, report, importKey: randomUUID(), confirmCutover: true,
      recomputeManifest: async () => report }, safety);
    expect(receipt.status).toBe("complete");
    expect(observed).toBe(1);
    expect(await f.sqlSnapshot()).toEqual(before);
    expect((await f.request(path, fixture.contributor.sub)).status).toBe(200);
    const { target, displayed } = await f.resolve(0);
    const marked = await f.command("workspace", { mode: "real", target,
      displayed_version: displayed, expected_head_id: null,
      mutation: { action: "select", basket_id: fixture.selectionBasket } }, fixture.contributor.sub);
    expect(marked.status).toBe(200);
    expect((await fixture.pool.query("SELECT * FROM facet_events")).rows).toHaveLength(1);
    for (const factory of factories) expect(factory).not.toHaveBeenCalled();
  });

  it("refuses unresolved-only activation without fabricating SQL or public state", async () => {
    const fixture = await cutoverFixture();
    const f = composeLotApp(fixture);
    const report = buildLotMigrationReport(syntheticInput([
      syntheticMark({ id: "mark-syn-unresolved-1", lotVersionId: "lot-version-missing-1" }),
    ], [], "mapping-syn-unresolved-v1", true));
    const before = await f.sqlSnapshot();
    const status = await runLotCutover(fixture.db, { workspaceId: fixture.workspaceId,
      actorSub: fixture.moderator.sub, report, importKey: randomUUID(), confirmCutover: true,
      recomputeManifest: async () => report }, recordingCutoverSafety().safety)
      .then(() => 200, (error: { status: number }) => error.status);
    expect(status).toBe(409);
    expect(await f.sqlSnapshot()).toEqual(before);
    const response = await f.request(`${f.lotBase}/heads?citySlug=synthetic-6j-city&mode=real`, fixture.contributor.sub);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "lot_cutover_closed" });
    expect((await fixture.pool.query("SELECT * FROM lot_cutover_state WHERE destination_open=true")).rows).toEqual([]);
  });
});
