/**
 * 6K cutover run without conflicts: nine protected stages, legacy
 * fencing, and committed readback.
 *
 * Activation is explicit (moderator plus confirmation), never automatic.
 * From the committed barrier on, legacy writers fail at the database
 * fence. Recovery retries the same explicit operation with the same
 * import key. Synthetic disposable databases.
 */
import { expect, it } from "vitest";
import { readLotCity } from "./lot-city.js";
import { readLotState } from "./lot-reader.js";
import {
  cutoverImportKeyFor,
  defaultCutoverSafety,
  evaluateActivationGate,
  LOT_CUTOVER_STAGES,
  readLotCutover,
  runLotCutover,
} from "./lot-cutover.js";
import {
  cleanCutoverReport,
  describeDb,
  cutoverFixture,
  recordingCutoverSafety,
} from "./cutover-fixture.js";

const LEGACY_INSERT =
  "INSERT INTO prospect_marks (lot_version_id, no_lot, city_slug, dimension, statut, author_id) VALUES ($1, $2, $3, $4, $5, $6)";

describeDb("6K cutover run without conflicts", () => {
  it("should complete nine stages, fence legacy writes, and serve independent facets", async () => {
    const f = await cutoverFixture();
    const { report, targetKeys } = cleanCutoverReport();
    const probe = recordingCutoverSafety();
    await f.pool.query(LEGACY_INSERT, ["6a000000-0000-4000-8000-0000000000aa",
      "SYN-6J-0001", "synthetic-6j-city", "pipeline", "favori", f.moderator.id]);
    const receipt = await runLotCutover(f.db, {
      workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true,
      recomputeManifest: async () => report,
    }, probe.safety);
    expect(receipt.status).toBe("complete");
    expect(receipt.stages).toEqual([...LOT_CUTOVER_STAGES]);
    expect(receipt.counts).toEqual({ ready: targetKeys.length, pending: 0, unavailable: 0 });
    expect(probe.drainCalls).toEqual([f.workspaceId]);
    expect(probe.readbackCalls).toEqual([f.workspaceId]);
    const status = await readLotCutover(f.db, f.workspaceId);
    expect(status).toMatchObject({ maintenanceBarrier: true, destinationOpen: true,
      manifestSha: report.manifestSha256 });
    await expect(f.pool.query(LEGACY_INSERT, ["6a000000-0000-4000-8000-0000000000aa",
      "SYN-6J-0002", "synthetic-6j-city", "pipeline", "favori", f.moderator.id]))
      .rejects.toThrow("lot_legacy_store_fenced");
    const legacy = await f.pool.query("SELECT count(*)::int AS n FROM prospect_marks");
    expect(legacy.rows[0]!.n).toBe(1);
    const city = await readLotCity(f.db, f.contributor.sub, f.workspaceId, "real", "synthetic-6j-city");
    expect(city.heads.map((head) => head.target.canonicalId).sort())
      .toEqual(["lot-canonical-syn-6j-01", "lot-canonical-syn-6j-02"]);
    const archived = city.heads.find((head) => head.target.canonicalId === "lot-canonical-syn-6j-01")!;
    expect(archived.archive.effectiveDiscarded).toBe(true);
    const current = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", archived.target);
    expect(current.pipeline).toBeNull();
    expect(current.selection).toEqual([]);
    const market = city.heads.find((head) => head.target.canonicalId === "lot-canonical-syn-6j-02")!;
    expect(market.market).toMatchObject({ state: "active" });
    await expect(runLotCutover(f.db, {
      workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true,
      recomputeManifest: async () => report,
    }, probe.safety)).rejects.toMatchObject({ status: 409, message: "lot_cutover_already_open" });
  });

  it("should keep the barrier closed without positive replica retirement", async () => {
    const f = await cutoverFixture();
    const { report } = cleanCutoverReport();
    const gate = await evaluateActivationGate(f.db, f.workspaceId, report);
    await expect(runLotCutover(f.db, {
      workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true,
      recomputeManifest: async () => report,
    }, defaultCutoverSafety(f.db, f.moderator.sub, gate.ready)))
      .rejects.toMatchObject({ status: 503, message: "lot_delivery_retirement_unconfirmed" });
    expect(await readLotCutover(f.db, f.workspaceId))
      .toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
  });

  it("should require confirmation, moderation, and a current manifest", async () => {
    const f = await cutoverFixture();
    const { report } = cleanCutoverReport();
    const probe = recordingCutoverSafety();
    const input = { workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId),
      recomputeManifest: async () => report };
    await expect(runLotCutover(f.db, { ...input, confirmCutover: false }, probe.safety))
      .rejects.toMatchObject({ status: 400 });
    await expect(runLotCutover(f.db, { ...input, actorSub: f.contributor.sub, confirmCutover: true },
      probe.safety)).rejects.toMatchObject({ status: 403 });
    const drifted = { ...report, manifestSha256: "f".repeat(64) };
    await expect(runLotCutover(f.db, { ...input, report: drifted, confirmCutover: true,
      recomputeManifest: async () => report }, probe.safety))
      .rejects.toMatchObject({ status: 409, message: "lot_manifest_drift" });
    await expect(runLotCutover(f.db, { ...input, confirmCutover: true,
      recomputeManifest: async () => ({ ...report, manifestSha256: "f".repeat(64) }) },
      probe.safety)).rejects.toMatchObject({ status: 409, message: "lot_manifest_drift" });
    const fenced = await readLotCutover(f.db, f.workspaceId);
    expect(fenced).toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
    await expect(f.pool.query(LEGACY_INSERT, ["6a000000-0000-4000-8000-0000000000aa",
      "SYN-6J-0001", "synthetic-6j-city", "pipeline", "favori", f.moderator.id]))
      .rejects.toThrow("lot_legacy_store_fenced");
  });
});
