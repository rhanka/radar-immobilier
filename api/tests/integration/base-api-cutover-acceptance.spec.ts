import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { baseAuth, baseCookie } from "./base-api-fixture.js";
import { EMPTY_DISCARDED_SIGNALS } from "../../src/services/graph/discarded-signals.js";
import type { ObjectStore } from "../../src/storage/object-store.js";
import { lotCutoverState } from "../../src/db/schema.js";
import { cleanCutoverReport, cutoverFixture, describeDb } from "../../src/services/facets/lots/cutover-fixture.js";
import { lotFixture } from "../../src/services/facets/lots/lot-fixture.js";
import { evaluateActivationGate } from "../../src/services/facets/lots/lot-cutover.js";
import { buildLotMigrationReport } from "../../src/services/facets/lot-migration-report/report.js";
import { syntheticInput, syntheticMark } from "../../src/services/facets/lot-migration-report/fixtures.js";
import { lotHttpFixture } from "./base-api-lot-http-fixture.js";

describeDb("b5 composed cutover acceptance", () => {
  it("holds public reads, history and replays closed before opening", async () => {
    const f = await lotHttpFixture();
    await f.fixture.db.delete(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, f.fixture.workspaceId));
    const { target, displayed } = await f.resolve(0);
    const sub = f.fixture.contributor.sub;
    const query = `citySlug=${target.citySlug}&canonicalId=${target.canonicalId}&mode=real`;
    for (const path of [`${f.lotBase}?${query}`, `${f.lotBase}/heads?citySlug=${target.citySlug}&mode=real`,
      `${f.lotBase}/history?${query}`, `${f.lotBase}/heads?citySlug=${target.citySlug}&mode=real&internal=true&readback=true&allowClosed=true`]) {
      const response = await f.request(path, sub);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "lot_cutover_closed" });
    }
    const key = randomUUID();
    const body = { mode: "real", target, displayed_version: displayed,
      expected_head_id: null, mutation: { action: "select", basket_id: f.fixture.selectionBasket } };
    expect((await f.command("workspace", body, sub, key)).status).toBe(503);
    const { mode, ...item } = body;
    expect((await f.batch("workspace", { mode, items: [item] }, sub, randomUUID())).status)
      .toBe(503);
    expect((await f.command("workspace", body, sub, key)).status).toBe(503);
  });

  it("gates unresolved-only, uncovered writers and qualified empty histories", async () => {
    const qualified = await cutoverFixture();
    const unresolved = buildLotMigrationReport(syntheticInput(
      [syntheticMark({ id: "mark-syn-unresolved-1", lotVersionId: "lot-version-missing-1" })],
      [], "mapping-syn-unresolved-v1", true));
    expect(unresolved.rows[0]!.disposition).toBe("unresolved");
    const unresolvedGate = await evaluateActivationGate(
      qualified.db, qualified.workspaceId, unresolved);
    expect(unresolvedGate.activatable).toBe(false);
    expect(unresolvedGate.reasons).toContain("no_activatable_targets");
    const open = await lotFixture();
    const uncoveredGate = await evaluateActivationGate(
      open.db, open.workspaceId, cleanCutoverReport().report);
    expect(uncoveredGate.activatable).toBe(false);
    expect(uncoveredGate.reasons.some((reason) => reason.startsWith("source_writers_uncovered")))
      .toBe(true);
    const empty = buildLotMigrationReport(syntheticInput([], [], "mapping-syn-empty-v1", true));
    const emptyGate = await evaluateActivationGate(qualified.db, qualified.workspaceId, empty);
    expect(emptyGate.activatable).toBe(true);
  });

  it("retires legacy delivery as explicit 503 then 410 with a successor", async () => {
    const f = await cutoverFixture();
    for (const [retirement, status, error] of [
      ["cutover-closed", 503, "legacy_cutover_closed"],
      ["retired", 410, "legacy_retired"],
    ] as const) {
      const app = createApp({ db: f.db, checkDb: async () => ({ ok: true }),
        checkObjectStore: async () => ({ ok: true }), store: {} as ObjectStore,
        discarded: EMPTY_DISCARDED_SIGNALS, auth: baseAuth, legacyRetirement: retirement });
      const response = await app.request("/api/graph-signals/some-city", {
        headers: { cookie: await baseCookie(f.contributor.sub) } });
      expect(response.status).toBe(status);
      const body = await response.json() as { error: string; successor: string };
      expect(body.error).toBe(error);
      expect(body.successor).toContain("coherent-city");
    }
  });
});
