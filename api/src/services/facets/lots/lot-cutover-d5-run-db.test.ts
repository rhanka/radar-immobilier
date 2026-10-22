/**
 * 6K cutover run with D5 dispositions: conflicted targets stay out
 * until a moderator records an explicit winning head, or stay out with
 * an explicit pending status. Every chain remains queryable evidence.
 * Synthetic disposable databases.
 */
import { expect, it } from "vitest";
import { readLotHistory, readLotSourceHistory } from "./lot-history.js";
import { readLotState } from "./lot-reader.js";
import {
  cutoverImportKeyFor,
  readLotCutover,
  recordD5Dispositions,
  runLotCutover,
} from "./lot-cutover.js";
import {
  conflictedCutoverReport,
  describeDb,
  cutoverFixture,
  recordingCutoverSafety,
} from "./cutover-fixture.js";

describeDb("6K cutover run with D5 dispositions", () => {
  it("should refuse activation while a conflicted target has no disposition", async () => {
    const f = await cutoverFixture();
    const { report } = conflictedCutoverReport();
    const before = await readLotCutover(f.db, f.workspaceId);
    expect(before).toMatchObject({ maintenanceBarrier: false, destinationOpen: false });
    await expect(runLotCutover(f.db, {
      workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true,
      recomputeManifest: async () => report,
    }, recordingCutoverSafety().safety))
      .rejects.toMatchObject({ status: 409, message: "d5_dispositions_missing:1" });
    const fenced = await readLotCutover(f.db, f.workspaceId);
    expect(fenced).toMatchObject({ maintenanceBarrier: false, destinationOpen: false });
  });

  it("should activate only the named winning head and keep every chain as evidence", async () => {
    const f = await cutoverFixture();
    const { report, conflictTargetKey, winnerSourceId, loserSourceId } = conflictedCutoverReport();
    await recordD5Dispositions(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, manifestSha: report.manifestSha256,
      decisions: [{ targetKey: conflictTargetKey, decision: "activate",
        sourceId: winnerSourceId, reason: "evidenced pipeline head" }] });
    const receipt = await runLotCutover(f.db, {
      workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true,
      recomputeManifest: async () => report,
    }, recordingCutoverSafety().safety);
    expect(receipt.status).toBe("complete");
    const state = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real",
      { type: "Lot", authority: "lot_versions",
        citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6k-03" });
    expect(state.pipeline).toMatchObject({ state: "active", pipelineStatus: "sollicite" });
    const winnerChain = report.rows.find((row) => row.sourceId === winnerSourceId)!.chainId;
    const loserChain = report.rows.find((row) => row.sourceId === loserSourceId)!.chainId;
    const winnerHistory = await readLotSourceHistory(
      f.db, f.contributor.sub, f.workspaceId, winnerChain, 0, 20);
    const loserHistory = await readLotSourceHistory(
      f.db, f.contributor.sub, f.workspaceId, loserChain, 0, 20);
    expect(winnerHistory.rows.map((row) => row.sourceId)).toEqual([winnerSourceId]);
    expect(loserHistory.rows.map((row) => row.sourceId)).toEqual([loserSourceId]);
    const destination = await readLotHistory(f.db, f.contributor.sub, f.workspaceId, "real",
      { type: "Lot", authority: "lot_versions",
        citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6k-03" }, 0, 20);
    expect(destination.events.filter((event) => event.facet === "pipeline")).toHaveLength(1);
  });

  it("should leave keep-pending targets outside activation with an explicit status", async () => {
    const f = await cutoverFixture();
    const { report, conflictTargetKey } = conflictedCutoverReport();
    await recordD5Dispositions(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, manifestSha: report.manifestSha256,
      decisions: [{ targetKey: conflictTargetKey, decision: "keep-pending",
        reason: "awaiting owner review" }] });
    const receipt = await runLotCutover(f.db, {
      workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true,
      recomputeManifest: async () => report,
    }, recordingCutoverSafety().safety);
    expect(receipt.status).toBe("complete");
    expect(receipt.pending).toEqual([{ targetKey: conflictTargetKey, cause: "d5-keep-pending" }]);
    await expect(readLotState(f.db, f.contributor.sub, f.workspaceId, "real",
      { type: "Lot", authority: "lot_versions",
        citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6k-03" }))
      .rejects.toMatchObject({ status: 409, message: "lot_target_pending" });
  });
});
