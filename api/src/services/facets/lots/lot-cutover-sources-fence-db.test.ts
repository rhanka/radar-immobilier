/**
 * 6K cutover source protection: a source change between reconciliation
 * and opening can no longer deadlock the resume.
 *
 * lot_versions writes are fenced durably while a barrier is committed and
 * the destination is still closed, so the server-side manifest recomputed
 * under the fence cannot drift after the heads are reconciled. Resume
 * replays the frozen generation exactly: no permanent block, no duplicate
 * projection, and version writes are accepted again once open.
 */
import { expect, it } from "vitest";
import { lotImportRuns, lotSourceRows } from "../../../db/schema.js";
import { MAPPING, makeCutoverApp } from "../../../routes/scoped-lot-cutover-harness.js";
import { cutoverImportKeyFor, readLotCutover, runLotCutover } from "./lot-cutover.js";
import { recomputeLotManifest } from "./lot-manifest-refresh.js";
import { lotEventCount } from "./lot-test-helpers.js";
import { LOT_6J_AA } from "./lot-import-input.js";
import {
  CUTOVER_CITY,
  cutoverFixture,
  describeDb,
  recordingCutoverSafety,
} from "./cutover-fixture.js";

const LEGACY_INSERT =
  "INSERT INTO prospect_marks (lot_version_id, no_lot, city_slug, dimension, statut, author_id) VALUES ($1, $2, $3, $4, $5, $6)";

describeDb("6K cutover source protection", () => {
  it("should fence source writes behind a committed barrier and release them after opening", async () => {
    const f = await cutoverFixture();
    await f.pool.query(LEGACY_INSERT, [LOT_6J_AA,
      "SYN-6J-0001", CUTOVER_CITY, "pipeline", "ecarte", f.moderator.id]);
    const report = await recomputeLotManifest(f.db, MAPPING);
    expect(report.rows).toHaveLength(1);

    await expect(runLotCutover(f.db, {
      workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true,
      recomputeManifest: () => recomputeLotManifest(f.db, MAPPING),
    }, { ...recordingCutoverSafety().safety, readbackAuthorized: async () => {
      const stages = await f.pool.query("SELECT stage FROM lot_cutover_events WHERE stage = 'switch-authority'");
      expect(stages.rows).toHaveLength(1);
      throw new Error("synthetic_interruption_after_reconciliation");
    } })).rejects.toThrow("synthetic_interruption_after_reconciliation");
    expect(await readLotCutover(f.db, f.workspaceId))
      .toMatchObject({ maintenanceBarrier: true, destinationOpen: false });
    const evidence = await f.db.select().from(lotSourceRows);
    const imports = await f.db.select().from(lotImportRuns);
    expect(evidence).toHaveLength(1);
    expect(imports).toHaveLength(1);
    expect(await lotEventCount(f)).toBe(1);
    const sourceError = await f.pool.query(
      `INSERT INTO lot_versions (id, canonical_id, no_lot, city_slug, recon_status,
        valid_from, known_from, raw_ref)
       VALUES ('6c000000-0000-4000-8000-0000000000d9', 'lot-canonical-syn-6k-09',
        'SYN-6K-0009', '${CUTOVER_CITY}', 'validated', '2025-01-01',
        '2025-01-01T00:00:00.000Z', 'synthetic-6k-fence')`,
    ).then(() => null, (error: Error) => error);
    await expect(f.pool.query(LEGACY_INSERT, [LOT_6J_AA,
      "SYN-6J-0002", CUTOVER_CITY, "pipeline", "favori", f.moderator.id]))
      .rejects.toThrow("lot_legacy_store_fenced");

    const resumed = await makeCutoverApp(f, { sub: f.moderator.sub }).request(
      `/api/v1/workspaces/${f.workspaceId}/lot-facets/cutover`, { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapping: MAPPING, confirmCutover: true }) });
    expect({ status: resumed.status, body: await resumed.json() })
      .toMatchObject({ status: 200, body: { receipt: { status: "complete" } } });
    expect(sourceError?.message).toContain("lot_cutover_sources_fenced");
    expect(await readLotCutover(f.db, f.workspaceId))
      .toMatchObject({ maintenanceBarrier: true, destinationOpen: true,
        manifestSha: report.manifestSha256 });
    expect(await lotEventCount(f)).toBe(1);
    expect(await f.db.select().from(lotSourceRows)).toEqual(evidence);
    expect(await f.db.select().from(lotImportRuns)).toEqual(imports);

    await f.pool.query(
      `INSERT INTO lot_versions (id, canonical_id, no_lot, city_slug, recon_status,
        valid_from, known_from, raw_ref)
       VALUES ('6c000000-0000-4000-8000-0000000000d9', 'lot-canonical-syn-6k-09',
        'SYN-6K-0009', '${CUTOVER_CITY}', 'validated', '2025-01-01',
        '2025-01-01T00:00:00.000Z', 'synthetic-6k-fence')`,
    );
    await expect(f.pool.query(LEGACY_INSERT, [LOT_6J_AA,
      "SYN-6J-0002", CUTOVER_CITY, "pipeline", "favori", f.moderator.id]))
      .rejects.toThrow("lot_legacy_store_fenced");
    const reopened = await recomputeLotManifest(f.db, MAPPING);
    expect(reopened.manifestSha256).not.toBe(report.manifestSha256);
    await expect(runLotCutover(f.db, {
      workspaceId: f.workspaceId, actorSub: f.moderator.sub, report: reopened,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true,
      recomputeManifest: () => recomputeLotManifest(f.db, MAPPING),
    }, recordingCutoverSafety().safety))
      .rejects.toMatchObject({ status: 409, message: "lot_cutover_already_open" });
    expect(await lotEventCount(f)).toBe(1);
  });

  it("should protect updates, deletes, and truncation until the destination opens", async () => {
    const f = await cutoverFixture();
    await f.pool.query(`INSERT INTO lot_cutover_state (workspace_id, maintenance_barrier)
      VALUES ($1, true)`, [f.workspaceId]);
    for (const query of [
      "UPDATE lot_versions SET recon_status = 'pending'",
      "DELETE FROM lot_versions",
      "TRUNCATE lot_versions CASCADE",
    ]) await expect(f.pool.query(query)).rejects.toThrow("lot_cutover_sources_fenced");
  });
});
