// B2 history: destination and source navigation require opening.
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { lotCutoverState } from "../../../db/schema.js";
import { writeLotFacet } from "./lot-writer.js";
import { readLotHistory, readLotSourceHistory } from "./lot-history.js";
import { runLotImport } from "./lot-importer.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { cutoverFixture, cleanCutoverReport } from "./cutover-fixture.js";
import { displayedFor, lotCommand } from "./lot-test-helpers.js";
import { cutoverImportKeyFor } from "./lot-cutover-types.js";

describeDb("B2 lot history behind opening", () => {
  it("should gate destination history and source navigation while closed", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket }));
    await f.db.update(lotCutoverState).set({ destinationOpen: false })
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    await expect(readLotHistory(f.db, f.contributor.sub, f.workspaceId, "real", target, 0, 20))
      .rejects.toMatchObject({ status: 503, message: `lot_destination_disabled:${f.workspaceId}` });
    await expect(readLotSourceHistory(f.db, f.contributor.sub, f.workspaceId, "chain-x", 0, 20))
      .rejects.toMatchObject({ status: 503 });
    await expect(readLotHistory(f.db, f.contributor.sub, f.workspaceId, "real", target, 0, 101))
      .rejects.toMatchObject({ status: 400 });
  });

  it("should preserve pagination, privacy and source evidence while open", async () => {
    const f = await cutoverFixture();
    const { report } = cleanCutoverReport();
    const receipt = await runLotImport(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report, importKey: cutoverImportKeyFor(f.workspaceId) },
      { enabled: true });
    expect(receipt.status).toBe("complete");
    await f.db.insert(lotCutoverState).values({ workspaceId: f.workspaceId,
      destinationOpen: true, maintenanceBarrier: true });
    const chains = [...new Set(report.rows.map((row) => row.chainId))].sort();
    expect(chains.length).toBeGreaterThan(0);
    const page = await readLotSourceHistory(f.db, f.moderator.sub, f.workspaceId, chains[0]!, 0, 1);
    expect(page.chainId).toBe(chains[0]);
    expect(page.rows.length).toBeLessThanOrEqual(1);
    expect(page.rows[0]).toMatchObject({ chainId: chains[0] });
    expect(page.rows[0]!.observed).toBeDefined();
    expect(page.rows[0]!.destination).toBeDefined();
    await f.db.update(lotCutoverState).set({ destinationOpen: false })
      .where(eq(lotCutoverState.workspaceId, f.workspaceId));
    await expect(readLotSourceHistory(f.db, f.moderator.sub, f.workspaceId, chains[0]!, 0, 1))
      .rejects.toMatchObject({ status: 503 });
    await expect(readLotSourceHistory(f.db, f.contributor.sub, f.workspaceId, "", 0, 20))
      .rejects.toMatchObject({ status: 400 });
    await expect(readLotHistory(f.db, f.contributor.sub, f.workspaceId, "real",
      { type: "Lot", authority: "lot_versions", citySlug: "synthetic-6j-city",
        canonicalId: "lot-canonical-syn-6j-01" }, 0, 101))
      .rejects.toMatchObject({ status: 400 });
  });
});
