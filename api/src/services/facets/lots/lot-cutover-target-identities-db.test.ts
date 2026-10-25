import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { lotCutoverState } from "../../../db/schema.js";
import { syntheticInput, syntheticMark } from "../lot-migration-report/fixtures.js";
import { buildLotMigrationReport } from "../lot-migration-report/report.js";
import { cutoverFixture, CUTOVER_CITY, describeDb } from "./cutover-fixture.js";
import { runLotImport } from "./lot-importer.js";
import { readLotCity } from "./lot-city.js";
import { readLotState } from "./lot-reader.js";
import { writeLotFacet } from "./lot-writer.js";
import { writeLotBatch } from "./lot-batch.js";
import { resolveLotSource } from "./lot-target.js";
import { lotCommand, lotEventCount } from "./lot-test-helpers.js";

describeDb("6K denormalized cutover identity", () => {
  it("should exclude a denormalized pending history from reads, commands, and city heads", async () => {
    const f = await cutoverFixture();
    await f.db.insert(lotCutoverState).values({ workspaceId: f.workspaceId,
      maintenanceBarrier: true, destinationOpen: true });
    const target = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: CUTOVER_CITY, canonicalId: "lot-canonical-syn-6j-01" };
    const displayed = (await resolveLotSource(f.db, target)).displayed;
    await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    const cityBefore = await readLotCity(f.db, f.contributor.sub, f.workspaceId, "real", CUTOVER_CITY);
    expect(cityBefore.heads.map((head) => head.target)).toEqual([target]);
    // Imported documentary history can reference a version absent from its
    // inventory. Its denormalized identity must follow the now-resolved lot.
    const report = buildLotMigrationReport(syntheticInput([syntheticMark({
      id: "synthetic-denormalized-history", lotVersionId: "missing-in-inventory",
      citySlug: CUTOVER_CITY, noLot: "SYN-6J-0001", statut: "ecarte",
    })], [], "synthetic-denormalized-mapping", true));
    expect(report.rows[0]?.nativeTarget).toBe(
      `denormalized:${JSON.stringify([CUTOVER_CITY, "SYN-6J-0001"])}`);
    await runLotImport(f.db, { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
      report, importKey: randomUUID() }, { enabled: true });
    await f.db.insert(lotCutoverState).values({ workspaceId: f.workspaceId,
      manifestSha: report.manifestSha256, maintenanceBarrier: true, destinationOpen: true })
      .onConflictDoUpdate({ target: lotCutoverState.workspaceId,
        set: { manifestSha: report.manifestSha256 } });
    const before = await lotEventCount(f);
    await expect(readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target))
      .rejects.toMatchObject({ status: 409, message: "lot_target_pending" });
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket })))
      .rejects.toMatchObject({ status: 409, message: "lot_target_pending" });
    await expect(writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", {
      contract_version: "lot-facets-v1", command_key: randomUUID(), mode: "real",
      items: [{ target, displayed_version: displayed, expected_head_id: null,
        mutation: { action: "select", basket_id: f.selectionBasket } }],
    })).rejects.toMatchObject({ status: 409, message: "lot_target_pending" });
    expect(await lotEventCount(f)).toBe(before);
    expect((await readLotCity(f.db, f.contributor.sub, f.workspaceId, "real", CUTOVER_CITY)).heads)
      .toEqual([]);
    expect((await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", {
      ...target, canonicalId: "lot-canonical-syn-6j-02",
    })).targetAvailable).toBe(true);
  });
});
