/** B4 slice 12: direct PostgreSQL qualification of the qualified 6K adapter. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { lotCutoverState } from "../../src/db/schema.js";
import { qualifiedLotCutoverSafety } from "../../src/services/facets/lots/lot-cutover-safety.js";
import { readLotCutoverReadback } from "../../src/services/facets/lots/lot-cutover-readback.js";
import { readLotCity } from "../../src/services/facets/lots/lot-city.js";
import { evaluateActivationGate, runLotCutover } from "../../src/services/facets/lots/lot-cutover.js";
import { buildLotMigrationReport } from "../../src/services/facets/lot-migration-report/report.js";
import { syntheticInput } from "../../src/services/facets/lot-migration-report/fixtures.js";
import {
  CUTOVER_CITY,
  cleanCutoverReport,
  cutoverFixture,
  describeDb,
  type CutoverFixture,
} from "../../src/services/facets/lots/cutover-fixture.js";

/** Server-supplied binding plus fresh qualified maintenance evidence. */
function boundEvidence(f: CutoverFixture, actorSub = f.moderator.sub) {
  const bound = { workspaceId: f.workspaceId, actorSub,
    maintenanceAttemptId: randomUUID(), releaseId: "synthetic-slice12-release",
    instanceIds: ["synthetic-old-a", "synthetic-old-b"] };
  const proof = { completedAt: new Date().toISOString(), coveredInstanceIds: bound.instanceIds };
  const evidence = { ...bound, reason: "synthetic slice 12 qualification", drain: proof, shutdown: proof };
  return { bound, evidence };
}

async function activatedFixture() {
  const f = await cutoverFixture();
  const { report } = cleanCutoverReport();
  const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
  expect(gate.activatable).toBe(true);
  const { bound, evidence } = boundEvidence(f);
  const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready);
  const realReadback = safety.readbackAuthorized;
  let readbacks = 0;
  safety.readbackAuthorized = async (workspaceId) => {
    const assertClosed = async () => {
      const [state] = await f.db.select().from(lotCutoverState)
        .where(eq(lotCutoverState.workspaceId, f.workspaceId));
      expect(state).toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
      await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
        .rejects.toMatchObject({ status: 503 });
    };
    await assertClosed();
    await realReadback(workspaceId);
    await assertClosed();
    readbacks++;
  };
  const receipt = await runLotCutover(f.db, { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
    report, importKey: randomUUID(), confirmCutover: true, recomputeManifest: async () => report }, safety);
  expect(receipt.status).toBe("complete");
  expect(readbacks).toBe(1);
  await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
    .resolves.toMatchObject({ citySlug: CUTOVER_CITY });
  return { f, gate, bound, evidence };
}

describeDb("qualified 6K operator activation and public closure", () => {
  it("should activate through the qualified adapter and verify real readback", async () => {
    const { f } = await activatedFixture();
    const readback = await readLotCutoverReadback(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY);
    expect(readback.heads.map((head) => head.target.canonicalId).sort())
      .toEqual(["lot-canonical-syn-6j-01", "lot-canonical-syn-6j-02"]);
  });

  it("should keep public reads closed while enforcing current rights", async () => {
    const { f, gate } = await activatedFixture();
    await f.db.update(lotCutoverState).set({ destinationOpen: false })
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 503 });
    await expect(readLotCutoverReadback(f.db, f.contributor.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 403 });
    const delegated = boundEvidence(f, f.contributor.sub);
    const safety = qualifiedLotCutoverSafety(f.db, delegated.bound, delegated.evidence, gate.ready);
    await expect(safety.readbackAuthorized(f.workspaceId)).rejects.toMatchObject({ status: 403 });
    await expect(safety.readbackAuthorized(f.otherId))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_workspace_mismatch" });
  });

  it("should reject empty ready-target iteration without silent success", async () => {
    const f = await cutoverFixture();
    const emptyReport = buildLotMigrationReport(syntheticInput([], [], "slice12-empty-v1", true));
    const emptyGate = await evaluateActivationGate(f.db, f.workspaceId, emptyReport);
    expect(emptyGate.activatable).toBe(true);
    expect(emptyGate.ready).toEqual([]);
    const { bound, evidence } = boundEvidence(f);
    const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, emptyGate.ready);
    await safety.drainDeliveryPaths(f.workspaceId);
    await expect(safety.readbackAuthorized(f.workspaceId))
      .rejects.toMatchObject({ status: 503, message: "lot_cutover_readback_unconfirmed" });
    await expect(runLotCutover(f.db, { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
      report: emptyReport, importKey: randomUUID(), confirmCutover: true,
      recomputeManifest: async () => emptyReport }, safety))
      .rejects.toMatchObject({ status: 503, message: "lot_cutover_readback_unconfirmed" });
    const [state] = await f.db.select().from(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    expect(state).toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
    await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 503 });
  });
});
