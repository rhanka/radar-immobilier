// B2 empty history: truly empty qualified manifests open; first mark is ordinary.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildLotMigrationReport } from "../lot-migration-report/report.js";
import { syntheticInput, syntheticMark } from "../lot-migration-report/fixtures.js";
import { writeLotFacet } from "./lot-writer.js";
import { readLotCity } from "./lot-city.js";
import { evaluateActivationGate } from "./lot-cutover.js";
import { cutoverImportKeyFor, runLotCutover } from "./lot-cutover.js";
import { runLotImport } from "./lot-importer.js";
import {
  CUTOVER_CITY,
  conflictedCutoverReport,
  describeDb,
  cutoverFixture,
  recordingCutoverSafety,
} from "./cutover-fixture.js";
import { displayedFor, lotCommand, lotEventCount } from "./lot-test-helpers.js";
import { unqualifiedLotReport } from "./lot-import-input.js";

function emptyQualifiedReport() {
  return buildLotMigrationReport(syntheticInput([], [], "mapping-syn-empty-v1", true));
}

describeDb("B2 empty cutover and first mark", () => {
  it("should open a truly empty qualified manifest and accept a first mark", async () => {
    const f = await cutoverFixture();
    const report = emptyQualifiedReport();
    expect(report.rows).toEqual([]);
    expect(report.destinationsQualified).toBe(true);
    const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
    expect(gate.activatable).toBe(true);
    expect(gate.requiresD5).toBe(false);
    expect(gate.ready).toEqual([]);
    const before = await lotEventCount(f);
    const imported = await runLotImport(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report, importKey: cutoverImportKeyFor(f.workspaceId) },
      { enabled: true });
    expect(imported.counts).toMatchObject({ sourceRows: 0, projected: 0, pending: 0 });
    expect(await lotEventCount(f)).toBe(before);
    const probe = recordingCutoverSafety();
    const receipt = await runLotCutover(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report, importKey: randomUUID(),
      confirmCutover: true, recomputeManifest: async () => report }, probe.safety);
    expect(receipt.status).toBe("complete");
    expect(receipt.counts).toMatchObject({ ready: 0, pending: 0, unavailable: 0 });
    expect(await lotEventCount(f)).toBe(before);
    const { target, displayed } = await displayedFor(f);
    const first = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    expect(first.events[0]).toMatchObject({ facet: "selection", state: "active" });
    const city = await readLotCity(f.db, f.contributor.sub, f.workspaceId, "real", CUTOVER_CITY);
    expect(city.heads.map((head) => head.target.canonicalId)).toContain(target.canonicalId);
  });

  it("should keep unresolved-only, conflicted and unqualified histories closed", async () => {
    const f = await cutoverFixture();
    const unqualified = await evaluateActivationGate(f.db, f.workspaceId, unqualifiedLotReport());
    expect(unqualified.activatable).toBe(false);
    expect(unqualified.reasons).toContain("destination_scope_unqualified");
    const emptyUnqualified = buildLotMigrationReport(syntheticInput([], [], "mapping-syn-empty-v1", false));
    const blocked = await evaluateActivationGate(f.db, f.workspaceId, emptyUnqualified);
    expect(blocked.activatable).toBe(false);
    const unresolvedOnly = buildLotMigrationReport(syntheticInput(
      [syntheticMark({ id: "mark-syn-unresolved-1", lotVersionId: "lot-version-missing-1" })],
      [], "mapping-syn-unresolved-v1", true));
    expect(unresolvedOnly.rows.length).toBe(1);
    expect(unresolvedOnly.rows[0]!.disposition).toBe("unresolved");
    const unresolvedGate = await evaluateActivationGate(f.db, f.workspaceId, unresolvedOnly);
    expect(unresolvedGate.activatable).toBe(false);
    expect(unresolvedGate.reasons).toContain("no_activatable_targets");
    const conflicted = conflictedCutoverReport();
    const conflictedGate = await evaluateActivationGate(f.db, f.workspaceId, conflicted.report);
    expect(conflictedGate.activatable).toBe(false);
    expect(conflictedGate.unavailable).toEqual([conflicted.conflictTargetKey]);
  });
});
