/** B4 slice 13: interrupted cutover resume and qualified empty history. */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { lotCutoverState } from "../../src/db/schema.js";
import { ScopeError } from "../../src/services/facets/scope.js";
import {
  qualifiedLotCutoverSafety,
} from "../../src/services/facets/lots/lot-cutover-safety.js";
import { expectedCutoverHeadValues } from "../../src/services/facets/lots/lot-cutover-expectations.js";
import { readLotCity } from "../../src/services/facets/lots/lot-city.js";
import { evaluateActivationGate, runLotCutover } from "../../src/services/facets/lots/lot-cutover.js";
import { buildLotMigrationReport } from "../../src/services/facets/lot-migration-report/report.js";
import { syntheticInput } from "../../src/services/facets/lot-migration-report/fixtures.js";
import { CUTOVER_CITY, cleanCutoverReport, cutoverFixture, describeDb, type CutoverFixture } from "../../src/services/facets/lots/cutover-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "../../src/services/facets/lots/lot-test-helpers.js";
import { writeLotFacet } from "../../src/services/facets/lots/lot-writer.js";

/** Server-supplied binding plus fresh qualified maintenance evidence. */
function boundEvidence(f: CutoverFixture, actorSub = f.moderator.sub) {
  const bound = { workspaceId: f.workspaceId, actorSub,
    maintenanceAttemptId: randomUUID(), releaseId: "synthetic-slice13-release",
    instanceIds: ["synthetic-old-a", "synthetic-old-b"] };
  const proof = { completedAt: new Date().toISOString(), coveredInstanceIds: bound.instanceIds };
  return { bound, evidence: { ...bound, reason: "synthetic slice 13 resume", drain: proof, shutdown: proof } };
}

describeDb("interrupted cutover and protected resume", () => {
  it("should recover an interrupted cutover without restoring legacy authority", async () => {
    const f = await cutoverFixture();
    const { report } = cleanCutoverReport();
    const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
    expect(gate.activatable).toBe(true);
    const importKey = randomUUID();
    const input = { workspaceId: f.workspaceId, actorSub: f.moderator.sub, report, importKey,
      confirmCutover: true, recomputeManifest: async () => report };
    const { bound, evidence } = boundEvidence(f);
    const expectedCutoverHeads = expectedCutoverHeadValues(report, gate.activatedSourceIds);
    const failing = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready, { expectedCutoverHeads });
    failing.readbackAuthorized = async () => {
      throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
    };
    await expect(runLotCutover(f.db, input, failing)).rejects.toMatchObject({ status: 503 });
    const [mid] = await f.db.select().from(lotCutoverState).where(eq(lotCutoverState.workspaceId, f.workspaceId));
    expect(mid).toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
    await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 503 });
    const wrong = boundEvidence(f, f.contributor.sub);
    const wrongSafety = qualifiedLotCutoverSafety(f.db, wrong.bound, wrong.evidence, gate.ready,
      { expectedCutoverHeads });
    await expect(runLotCutover(f.db, { ...input, actorSub: f.contributor.sub }, wrongSafety))
      .rejects.toMatchObject({ status: 403 });
    const receipt = await runLotCutover(f.db, input,
      qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready, { expectedCutoverHeads }));
    expect(receipt.status).toBe("complete");
    await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .resolves.toMatchObject({ citySlug: CUTOVER_CITY });
    const [done] = await f.db.select().from(lotCutoverState).where(eq(lotCutoverState.workspaceId, f.workspaceId));
    expect(done).toMatchObject({ maintenanceBarrier: true, destinationOpen: true });
    const emptyClaim = qualifiedLotCutoverSafety(f.db, bound, evidence, [],
      { qualifiedEmptyManifest: true, emptyReadbackScope: { citySlugs: [CUTOVER_CITY], modes: ["real"] },
        expectedCutoverHeads: [] });
    await expect(emptyClaim.readbackAuthorized(f.workspaceId))
      .rejects.toMatchObject({ status: 503, message: "lot_cutover_readback_unconfirmed" });
    const fence = await f.db.execute<{ enabled: boolean }>(sql`SELECT enabled FROM lot_legacy_fence`);
    expect(fence.rows[0]).toMatchObject({ enabled: true });
    await expect(runLotCutover(f.db, { ...input, importKey: randomUUID() },
      qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready, { expectedCutoverHeads })))
      .rejects.toMatchObject({ status: 409 });
    const [still] = await f.db.select().from(lotCutoverState).where(eq(lotCutoverState.workspaceId, f.workspaceId));
    expect(still?.manifestSha).toBe(done?.manifestSha);
    await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .resolves.toMatchObject({ citySlug: CUTOVER_CITY });
  });

  it("should open a qualified empty history with real zero-head proof", async () => {
    const f = await cutoverFixture();
    const emptyReport = buildLotMigrationReport(syntheticInput([], [], "slice13-empty-v1", true));
    const emptyGate = await evaluateActivationGate(f.db, f.workspaceId, emptyReport);
    expect(emptyGate.activatable).toBe(true);
    expect(emptyGate.ready).toEqual([]);
    const { bound, evidence } = boundEvidence(f);
    const emptyExpected = expectedCutoverHeadValues(emptyReport, emptyGate.activatedSourceIds);
    const silent = qualifiedLotCutoverSafety(f.db, bound, evidence, emptyGate.ready,
      { expectedCutoverHeads: emptyExpected });
    await expect(silent.readbackAuthorized(f.workspaceId))
      .rejects.toMatchObject({ status: 503, message: "lot_cutover_readback_unconfirmed" });
    const input = { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
      report: emptyReport, importKey: randomUUID(), confirmCutover: true,
      recomputeManifest: async () => emptyReport };
    const before = await lotEventCount(f);
    await expect(runLotCutover(f.db, input,
      qualifiedLotCutoverSafety(f.db, bound, evidence, emptyGate.ready,
        { qualifiedEmptyManifest: true, expectedCutoverHeads: emptyExpected })))
      .rejects.toMatchObject({ status: 503, message: "lot_cutover_readback_unconfirmed" });
    const assertClosed = async () => {
      const [state] = await f.db.select().from(lotCutoverState)
        .where(eq(lotCutoverState.workspaceId, f.workspaceId));
      expect(state).toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
      await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
        .rejects.toMatchObject({ status: 503 });
    };
    await assertClosed();
    const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, emptyGate.ready,
      { qualifiedEmptyManifest: true, emptyReadbackScope: { citySlugs: [CUTOVER_CITY], modes: ["real"] },
        expectedCutoverHeads: emptyExpected });
    const realReadback = safety.readbackAuthorized;
    let readbacks = 0;
    safety.readbackAuthorized = async (workspaceId) => {
      await assertClosed();
      await realReadback(workspaceId);
      await assertClosed();
      readbacks++;
    };
    const receipt = await runLotCutover(f.db, input, safety);
    expect(receipt.status).toBe("complete");
    expect(receipt.counts).toMatchObject({ ready: 0, pending: 0, unavailable: 0 });
    expect(readbacks).toBe(1);
    expect(await lotEventCount(f)).toBe(before);
    const { target, displayed } = await displayedFor(f);
    const first = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    expect(first.events[0]).toMatchObject({ facet: "selection", state: "active" });
    const city = await readLotCity(f.db, f.contributor.sub, f.workspaceId, "real", CUTOVER_CITY);
    expect(city.heads.map((head) => head.target.canonicalId)).toContain(target.canonicalId);
  });
});
