/**
 * 6K post-cutover independent facets: the selection, pipeline, market,
 * archive, and clearing scenario on one target. Every facet stays
 * usable on its own; restoration never recreates a removed selection.
 * Synthetic disposable database.
 */
import { expect, it } from "vitest";
import { readLotState } from "./lot-reader.js";
import { cutoverImportKeyFor, runLotCutover } from "./lot-cutover.js";
import {
  cleanCutoverReport,
  describeDb,
  cutoverFixture,
  recordingCutoverSafety,
} from "./cutover-fixture.js";
import { displayedFor, lotCommand } from "./lot-test-helpers.js";
import { writeLotFacet } from "./lot-writer.js";

describeDb("6K post-cutover independent facets", () => {
  it("should run the selection, pipeline, market, archive, and clearing scenario", async () => {
    const f = await cutoverFixture();
    const { report } = cleanCutoverReport();
    await runLotCutover(f.db, {
      workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true,
      recomputeManifest: async () => report,
    }, recordingCutoverSafety().safety);
    const basket = f.selectionBasket;
    const { target, displayed } = await displayedFor(f, 1);
    const initial = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    const selected = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: basket }));
    const solicited = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_pipeline", status: "sollicite" }));
    expect(solicited.events[0]).toMatchObject({ facet: "pipeline", state: "active" });
    const market = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_market", status: "en_vente",
        asking_price: "300000.00", listing_url: "https://synthetic.invalid/annonce/6k-2" }, initial.market!.id));
    expect(market.events[0]).toMatchObject({ askingPrice: "300000.00" });
    const archived = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "discard", reasonCode: "N-NON-RES",
        deselect: [{ basket_id: basket, expected_head_id: selected.heads[0]!.id }] }));
    expect(archived.events.find((event) => event.facet === "archive"))
      .toMatchObject({ state: "active" });
    const revealed = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(revealed.archive.effectiveDiscarded).toBe(true);
    expect(revealed.selection.map((head) => head.state)).toEqual(["inactive"]);
    expect(revealed.pipeline).toMatchObject({ pipelineStatus: "sollicite" });
    const repriced = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "set_market", status: "en_vente",
        asking_price: "310000.00", listing_url: "https://synthetic.invalid/annonce/6k-3" },
      market.heads[0]!.id));
    expect(repriced.events[0]).toMatchObject({ askingPrice: "310000.00" });
    const restored = await writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "restore" },
        archived.heads.find((head) => head.facet === "archive")!.id));
    expect(restored.events[0]).toMatchObject({ state: "inactive" });
    const afterRestore = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(afterRestore.archive.effectiveDiscarded).toBe(false);
    expect(afterRestore.selection.map((head) => head.state)).toEqual(["inactive"]);
    expect(afterRestore.pipeline).toMatchObject({ pipelineStatus: "sollicite" });
    expect(afterRestore.market).toMatchObject({ askingPrice: "310000.00" });
    const clearedPipeline = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "clear_pipeline" }, solicited.heads[0]!.id));
    expect(clearedPipeline.events[0]).toMatchObject({ facet: "pipeline", state: "inactive" });
    const clearedMarket = await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "clear_market" }, repriced.heads[0]!.id));
    expect(clearedMarket.events[0]).toMatchObject({ facet: "market", state: "inactive" });
    const cleared = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(cleared.pipeline).toMatchObject({ state: "inactive" });
    expect(cleared.market).toMatchObject({ state: "inactive" });
    expect(cleared.selection.map((head) => head.state)).toEqual(["inactive"]);
  });
});
