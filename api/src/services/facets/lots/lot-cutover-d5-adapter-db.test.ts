// 6K D5 winner qualified through the real adapter; a head carrying the
// losing values is refused at resume with public reads kept closed.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { lotCutoverState } from "../../../db/schema.js";
import { readLotCity } from "./lot-city.js";
import { readLotState } from "./lot-reader.js";
import { expectedCutoverHeadValues } from "./lot-cutover-expectations.js";
import {
  evaluateActivationGate,
  recordD5Dispositions,
  runLotCutover,
} from "./lot-cutover.js";
import { qualifiedLotCutoverSafety } from "./lot-cutover-safety.js";
import { ScopeError } from "../scope.js";
import {
  CUTOVER_CITY,
  conflictedCutoverReport,
  cutoverFixture,
  describeDb,
  type CutoverFixture,
} from "./cutover-fixture.js";

/** Server-supplied binding plus fresh qualified maintenance evidence. */
function boundEvidence(f: CutoverFixture) {
  const bound = { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
    maintenanceAttemptId: randomUUID(), releaseId: "synthetic-d5-release",
    instanceIds: ["synthetic-old-a", "synthetic-old-b"] };
  const proof = { completedAt: new Date().toISOString(), coveredInstanceIds: bound.instanceIds };
  return { bound, evidence: { ...bound, reason: "synthetic d5 proof", drain: proof, shutdown: proof } };
}

/** Bypass immutable-history guards only to simulate damaged disposable storage. */
async function corrupt(f: CutoverFixture, query: string, params: unknown[]) {
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN; SET LOCAL session_replication_role = replica");
    await client.query(query, params);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Conflicted manifest with the winning head named, reconciled but still closed. */
async function reconciledConflict() {
  const f = await cutoverFixture();
  const { report, conflictTargetKey, winnerSourceId, loserSourceId } = conflictedCutoverReport();
  await recordD5Dispositions(f.db, { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
    manifestSha: report.manifestSha256, decisions: [{ targetKey: conflictTargetKey,
      decision: "activate", sourceId: winnerSourceId, reason: "synthetic d5 evidence" }] });
  const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
  expect(gate.activatable).toBe(true);
  const input = { workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
    importKey: randomUUID(), confirmCutover: true as const, recomputeManifest: async () => report };
  const { bound, evidence } = boundEvidence(f);
  const failing = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready,
    { expectedCutoverHeads: expectedCutoverHeadValues(report, gate.activatedSourceIds) });
  failing.readbackAuthorized = async () => {
    throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
  };
  await expect(runLotCutover(f.db, input, failing)).rejects.toMatchObject({ status: 503 });
  return { f, report, gate, input, bound, evidence, conflictTargetKey, winnerSourceId, loserSourceId };
}

describeDb("6K D5 winner through the real adapter", () => {
  it("should open the named winning head through the real adapter", async () => {
    const f = await cutoverFixture();
    const { report, conflictTargetKey, winnerSourceId } = conflictedCutoverReport();
    await recordD5Dispositions(f.db, { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
      manifestSha: report.manifestSha256, decisions: [{ targetKey: conflictTargetKey,
        decision: "activate", sourceId: winnerSourceId, reason: "synthetic d5 evidence" }] });
    const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
    expect(gate.activatable).toBe(true);
    const { bound, evidence } = boundEvidence(f);
    const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready,
      { expectedCutoverHeads: expectedCutoverHeadValues(report, gate.activatedSourceIds) });
    const receipt = await runLotCutover(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report, importKey: randomUUID(),
      confirmCutover: true, recomputeManifest: async () => report }, safety);
    expect(receipt.status).toBe("complete");
    const state = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real",
      { type: "Lot", authority: "lot_versions",
        citySlug: CUTOVER_CITY, canonicalId: "lot-canonical-syn-6k-03" });
    expect(state.pipeline).toMatchObject({ state: "active", pipelineStatus: "sollicite" });
  });

  it("should refuse a head carrying the losing values at resume", async () => {
    const { f, report, gate, input, bound, evidence } = await reconciledConflict();
    await corrupt(f, `UPDATE facet_events SET pipeline_status = 'lettre_envoyee' WHERE id IN
      (SELECT b.event_id FROM facet_event_bindings b JOIN facet_streams s ON s.id = b.stream_id
       WHERE s.workspace_id = $1 AND s.node_id = $2 AND s.facet = 'pipeline')`,
      [f.workspaceId, "lot-canonical-syn-6k-03"]);
    const safety = qualifiedLotCutoverSafety(f.db, bound, evidence, gate.ready,
      { expectedCutoverHeads: expectedCutoverHeadValues(report, gate.activatedSourceIds) });
    const observed = await runLotCutover(f.db, input, safety)
      .then(() => 200, (error: { status: number }) => error.status);
    expect(observed).toBe(503);
    const [state] = await f.db.select().from(lotCutoverState)
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    expect(state).toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
    await expect(readLotCity(f.db, f.moderator.sub, f.workspaceId, "real", CUTOVER_CITY))
      .rejects.toMatchObject({ status: 503 });
    await expect(safety.readbackAuthorized(f.workspaceId))
      .rejects.toMatchObject({ status: 503, message: "lot_cutover_readback_unconfirmed" });
  });
});
