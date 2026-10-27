/**
 * 6K activation gate and D5 dispositions.
 *
 * The gate is complete: without conflicts no approval step exists; with
 * conflicts the affected targets stay unavailable until a moderator
 * records an explicit disposition for each of them against the exact
 * manifest digest. Stale digests never authorize. Synthetic disposable
 * databases.
 */
import { expect, it } from "vitest";
import { attestLotSourceWriter } from "./lot-source-coverage.js";
import {
  evaluateActivationGate,
  recordD5Dispositions,
} from "./lot-cutover.js";
import {
  cleanCutoverReport,
  conflictedCutoverReport,
  describeDb,
  cutoverFixture,
} from "./cutover-fixture.js";
import { lotFixture } from "./lot-fixture.js";
import { unqualifiedLotReport } from "./lot-import-input.js";

describeDb("6K activation gate without conflicts", () => {
  it("should open with no approval step when the manifest is clean", async () => {
    const f = await cutoverFixture();
    const { report, targetKeys } = cleanCutoverReport();
    const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
    expect(gate.requiresD5).toBe(false);
    expect(gate.activatable).toBe(true);
    expect(gate.reasons).toEqual([]);
    expect(gate.ready.sort()).toEqual([...targetKeys].sort());
    expect(gate.unavailable).toEqual([]);
    expect(gate.pending).toEqual([]);
  });

  it("should block when writers stay uncovered, mapping is unqualified, or nothing is ready", async () => {
    const bare = await lotFixture();
    const { report } = cleanCutoverReport();
    const uncovered = await evaluateActivationGate(bare.db, bare.workspaceId, report);
    expect(uncovered.activatable).toBe(false);
    expect(uncovered.reasons.some((reason) => reason.startsWith("source_writers_uncovered:")))
      .toBe(true);
    const f = await cutoverFixture();
    const unqualified = await evaluateActivationGate(f.db, f.workspaceId, unqualifiedLotReport());
    expect(unqualified.activatable).toBe(false);
    expect(unqualified.reasons).toContain("destination_scope_unqualified");
  });

  it("should refuse coverage attestation reasons that are not explicit", async () => {
    const f = await cutoverFixture();
    await expect(f.db.transaction(async (tx) => {
      await attestLotSourceWriter(tx, "geo/ogc-pull", true, "x".repeat(1025));
    })).rejects.toThrow("invalid_coverage_reason");
  });
});

describeDb("6K activation gate with conflicts", () => {
  it("should hold conflicted targets unavailable until dispositions are recorded", async () => {
    const f = await cutoverFixture();
    const { report, conflictTargetKey, mappedTargetKeys } = conflictedCutoverReport();
    const blocked = await evaluateActivationGate(f.db, f.workspaceId, report);
    expect(blocked.requiresD5).toBe(true);
    expect(blocked.activatable).toBe(false);
    expect(blocked.unavailable).toEqual([conflictTargetKey]);
    expect(blocked.ready.sort()).toEqual([...mappedTargetKeys].sort());
    expect(blocked.reasons).toContain("d5_dispositions_missing:1");
  });

  it("should validate disposition shape and moderator capability", async () => {
    const f = await cutoverFixture();
    const { report, conflictTargetKey, winnerSourceId } = conflictedCutoverReport();
    await expect(recordD5Dispositions(f.db, { workspaceId: f.workspaceId,
      actorSub: f.contributor.sub, manifestSha: report.manifestSha256,
      decisions: [{ targetKey: conflictTargetKey, decision: "keep-pending", reason: "wait" }] }))
      .rejects.toMatchObject({ status: 403 });
    await expect(recordD5Dispositions(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, manifestSha: report.manifestSha256, decisions: [] }))
      .rejects.toMatchObject({ status: 400 });
    await expect(recordD5Dispositions(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, manifestSha: report.manifestSha256,
      decisions: [{ targetKey: conflictTargetKey, decision: "activate", reason: "pick" }] }))
      .rejects.toMatchObject({ status: 400 });
    await expect(recordD5Dispositions(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, manifestSha: "0".repeat(64),
      decisions: [{ targetKey: conflictTargetKey, decision: "keep-pending", reason: "wait" }] }))
      .resolves.toMatchObject({ recorded: 1 });
    const stale = await evaluateActivationGate(f.db, f.workspaceId, report);
    expect(stale.unavailable).toEqual([conflictTargetKey]);
    const recorded = await recordD5Dispositions(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, manifestSha: report.manifestSha256,
      decisions: [{ targetKey: conflictTargetKey, decision: "activate",
        sourceId: winnerSourceId, reason: "evidenced head" }] });
    expect(recorded).toEqual({ recorded: 1, targetKeys: [conflictTargetKey] });
    await expect(recordD5Dispositions(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, manifestSha: report.manifestSha256,
      decisions: [{ targetKey: conflictTargetKey, decision: "keep-pending", reason: "change" }] }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("should keep an ambiguous activation unavailable without an explicit winning row", async () => {
    const f = await cutoverFixture();
    const { report, conflictTargetKey, winnerSourceId } = conflictedCutoverReport();
    await recordD5Dispositions(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, manifestSha: report.manifestSha256,
      decisions: [{ targetKey: conflictTargetKey, decision: "activate",
        sourceId: "mark-6k-unknown", reason: "wrong row" }] });
    const ambiguous = await evaluateActivationGate(f.db, f.workspaceId, report);
    expect(ambiguous.activatable).toBe(false);
    expect(ambiguous.unavailable).toEqual([conflictTargetKey]);
    expect(ambiguous.reasons).toContain(`d5_ambiguous_head:${conflictTargetKey}`);
    expect(winnerSourceId).not.toBe("mark-6k-unknown");
  });
});
