import { expect, it } from "vitest";
import { cleanCutoverReport, cutoverFixture, describeDb, recordingCutoverSafety } from "./cutover-fixture.js";
import { cutoverImportKeyFor, LOT_CUTOVER_STAGES, readLotCutover, runLotCutover } from "./lot-cutover.js";

describeDb("6K cutover recovery", () => {
  it.each(LOT_CUTOVER_STAGES)("should recover after failure at %s without reopening legacy storage", async (stage) => {
    const f = await cutoverFixture();
    const { report } = cleanCutoverReport();
    await f.pool.query(`CREATE FUNCTION synthetic_reject_cutover_stage() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.stage = '${stage}' THEN RAISE EXCEPTION 'synthetic_stage_failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_stage_failure BEFORE INSERT ON lot_cutover_events
      FOR EACH ROW EXECUTE FUNCTION synthetic_reject_cutover_stage()`);
    const input = { workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true, recomputeManifest: async () => report };
    await expect(runLotCutover(f.db, input, recordingCutoverSafety().safety)).rejects.toThrow();
    expect(await readLotCutover(f.db, f.workspaceId)).toMatchObject({
      maintenanceBarrier: stage !== "commit-barrier", destinationOpen: false,
    });
    await f.pool.query("DROP TRIGGER synthetic_stage_failure ON lot_cutover_events");
    expect((await runLotCutover(f.db, input, recordingCutoverSafety().safety)).status).toBe("complete");
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events WHERE target_type = 'lot'"))
      .rows[0]!.n).toBe(2);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM lot_source_rows")).rows[0]!.n)
      .toBe(report.rows.length);
  });

  it("should fence a writer holding a snapshot from before activation", async () => {
    const f = await cutoverFixture();
    const old = await f.pool.connect();
    try {
      await old.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await old.query("SELECT * FROM lot_legacy_fence");
      const { report } = cleanCutoverReport();
      await runLotCutover(f.db, { workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
        importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true, recomputeManifest: async () => report },
      recordingCutoverSafety().safety);
      await expect(old.query(`INSERT INTO prospect_marks
        (lot_version_id, no_lot, city_slug, dimension, statut, author_id)
        VALUES ('6a000000-0000-4000-8000-0000000000aa', 'SYN-6J-0001', 'synthetic-6j-city',
          'pipeline', 'favori', $1)`, [f.moderator.id])).rejects.toMatchObject({ code: "40001" });
    } finally { await old.query("ROLLBACK"); old.release(); }
  });
});
