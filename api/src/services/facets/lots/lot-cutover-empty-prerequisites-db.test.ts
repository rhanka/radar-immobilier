// Empty history retains every activation prerequisite.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { facetActivationState, lotCapabilityGrants, lotDestinationState,
  lotSourceWriterCoverage } from "../../../db/schema.js";
import { buildLotMigrationReport } from "../lot-migration-report/report.js";
import { syntheticInput } from "../lot-migration-report/fixtures.js";
import { evaluateActivationGate, readLotCutover, runLotCutover } from "./lot-cutover.js";
import { cutoverFixture, describeDb, recordingCutoverSafety } from "./cutover-fixture.js";
import { lotEventCount } from "./lot-test-helpers.js";

describeDb("B2 empty activation prerequisites", () => {
  it.each(["epoch", "coverage", "roster", "destination", "qualification"] as const)(
    "should reject empty activation without %s", async (missing) => {
    const f = await cutoverFixture();
    if (missing === "epoch") await f.db.update(facetActivationState).set({ maintenanceBarrier: true })
      .where(eq(facetActivationState.workspaceId, f.workspaceId));
    if (missing === "coverage") await f.db.delete(lotSourceWriterCoverage);
    if (missing === "roster") await f.db.update(lotCapabilityGrants).set({ granted: false })
      .where(eq(lotCapabilityGrants.capability, "lot_market"));
    if (missing === "destination") await f.db.update(lotDestinationState).set({ enabled: false })
      .where(eq(lotDestinationState.workspaceId, f.workspaceId));
    const report = buildLotMigrationReport(syntheticInput([], [], "empty-prerequisite-v1",
      missing !== "qualification"));
    const expected = { epoch: "scoped_epoch_unavailable", coverage: "source_writers_uncovered:",
      roster: "lot_grant_missing:lot_market", destination: "lot_destination_disabled",
      qualification: "destination_scope_unqualified" }[missing];
    const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
    expect(gate.activatable).toBe(false);
    expect(gate.reasons.some((reason) => reason.startsWith(expected))).toBe(true);
    const probe = recordingCutoverSafety();
    const before = await lotEventCount(f);
    await expect(runLotCutover(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report, importKey: randomUUID(), confirmCutover: true,
      recomputeManifest: async () => report }, probe.safety)).rejects.toMatchObject({ status: 409 });
    expect(probe.drainCalls).toEqual([]);
    expect(await readLotCutover(f.db, f.workspaceId)).toMatchObject({ destinationOpen: false });
    expect(await lotEventCount(f)).toBe(before);
  });
});
