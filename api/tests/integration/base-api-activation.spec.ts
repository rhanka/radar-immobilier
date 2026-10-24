/** B4 slice 12: direct PostgreSQL qualification of the qualified 6K adapter. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { lotCutoverState } from "../../src/db/schema.js";
import { ScopeError } from "../../src/services/facets/scope.js";
import {
  qualifiedLotCutoverSafety,
} from "../../src/services/facets/lots/lot-cutover-safety.js";
import { expectedCutoverHeadValues } from "../../src/services/facets/lots/lot-cutover-expectations.js";
import { readLotCutoverReadback } from "../../src/services/facets/lots/lot-cutover-readback.js";
import { readLotCity } from "../../src/services/facets/lots/lot-city.js";
import { evaluateActivationGate, runLotCutover } from "../../src/services/facets/lots/lot-cutover.js";
import type { LotMigrationReport } from "../../src/services/facets/lot-migration-report/manifest.js";
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

function cutoverInput(f: CutoverFixture, report: LotMigrationReport, importKey: string) {
  return { workspaceId: f.workspaceId, actorSub: f.moderator.sub, report, importKey,
    confirmCutover: true as const, recomputeManifest: async () => report };
}

/** Bypass immutable-history guards only to simulate damaged disposable storage. */
async function corrupt(f: CutoverFixture, query: string) {
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN; SET LOCAL session_replication_role = replica");
    await client.query(query, [f.workspaceId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Reconciled but still closed: first run interrupted at readback, resume reuses its key. */
async function interruptedFixture() {
  const f = await cutoverFixture();
  const { report } = cleanCutoverReport();
  const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
  expect(gate.activatable).toBe(true);
  const { bound, evidence } = boundEvidence(f);
  const expectedCutoverHeads = expectedCutoverHeadValues(report, gate.activatedSourceIds);
  const input = cutoverInput(f, report, randomUUID());
  const failing = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready, { expectedCutoverHeads });
  failing.readbackAuthorized = async () => {
    throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
  };
  await expect(runLotCutover(f.db, input, failing)).rejects.toMatchObject({ status: 503 });
  return { f, report, gate, bound, evidence, expectedCutoverHeads, input };
}

async function activatedFixture() {
  const f = await cutoverFixture();
  const { report } = cleanCutoverReport();
  const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
  expect(gate.activatable).toBe(true);
  const { bound, evidence } = boundEvidence(f);
  const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready,
    { expectedCutoverHeads: expectedCutoverHeadValues(report, gate.activatedSourceIds) });
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
  return { f, gate, bound, evidence, report };
}

describeDb("qualified 6K operator activation and public closure", () => {
  it("should activate through the qualified adapter and verify real readback", async () => {
    const { f } = await activatedFixture();
    const readback = await readLotCutoverReadback(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY);
    expect(readback.heads.map((head) => head.target.canonicalId).sort())
      .toEqual(["lot-canonical-syn-6j-01", "lot-canonical-syn-6j-02"]);
  });

  it("should keep public reads closed while enforcing current rights", async () => {
    const { f, gate, report } = await activatedFixture();
    await f.db.update(lotCutoverState).set({ destinationOpen: false })
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 503 });
    await expect(readLotCutoverReadback(f.db, f.contributor.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 403 });
    const delegated = boundEvidence(f, f.contributor.sub);
    const safety = qualifiedLotCutoverSafety(f.db, delegated.bound, delegated.evidence, gate.ready,
      { expectedCutoverHeads: expectedCutoverHeadValues(report, gate.activatedSourceIds) });
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
    const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, emptyGate.ready,
      { expectedCutoverHeads: expectedCutoverHeadValues(emptyReport, emptyGate.activatedSourceIds) });
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

  it("should keep 503 when a reconciled head goes missing before resume", async () => {
    const { f, gate, bound, evidence, expectedCutoverHeads, input } = await interruptedFixture();
    await corrupt(f, `DELETE FROM facet_heads WHERE stream_id =
      (SELECT id FROM facet_streams WHERE workspace_id = $1 LIMIT 1)`);
    const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready, { expectedCutoverHeads });
    const result: unknown = await runLotCutover(f.db, input, safety).catch((error: unknown) => error);
    expect(result).toMatchObject({ status: 503, message: "lot_cutover_readback_unconfirmed" });
    const [state] = await f.db.select().from(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    expect(state).toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
    await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 503 });
  });

  it("should keep 503 when a reconciled head value diverges from the manifest", async () => {
    const { f, gate, bound, evidence, expectedCutoverHeads, input } = await interruptedFixture();
    await corrupt(f, `UPDATE facet_events SET asking_price = '1.00' WHERE id IN
      (SELECT e.id FROM facet_events e JOIN facet_event_bindings b ON b.event_id = e.id
       JOIN facet_streams s ON s.id = b.stream_id
       WHERE s.workspace_id = $1 AND e.facet = 'market')`);
    const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready, { expectedCutoverHeads });
    const result: unknown = await runLotCutover(f.db, input, safety).catch((error: unknown) => error);
    expect(result).toMatchObject({ status: 503, message: "lot_cutover_readback_unconfirmed" });
    const [state] = await f.db.select().from(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    expect(state).toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
    await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 503 });
  });
});
