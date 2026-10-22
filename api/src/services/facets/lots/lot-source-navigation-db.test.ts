// 6J projection/source navigation: from an authorized read or
// destination event, reach the justifying source chain, and back —
// without reading the import manifest.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { lotSourceRows } from "../../../db/schema.js";
import { readLotHistory, readLotSourceHistory } from "./lot-history.js";
import { readLotState } from "./lot-reader.js";
import { runLotImport } from "./lot-importer.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { qualifiedLotReport } from "./lot-import-input.js";

describeDb("6J lot source navigation", () => {
  it("should navigate from a projection to its source chain and back", async () => {
    const f = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true });
    const target = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" };
    const state = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    const chainId = state.archive.workspace?.source?.sourceChainId;
    expect(chainId).toEqual(expect.stringMatching(/./));
    expect(state.archive.workspace?.source?.sourceRowId).toBe("mark-6j-0003");
    const source = await readLotSourceHistory(
      f.db, f.contributor.sub, f.workspaceId, chainId!, 0, 10);
    expect(source.rows.map((row) => row.sourceId)).toEqual(
      ["mark-6j-0001", "mark-6j-0002", "mark-6j-0003"]);
    expect(source.target).toEqual(target);
    expect(source.mode).toBe("real");
    const history = await readLotHistory(f.db, f.contributor.sub, f.workspaceId,
      source.mode!, source.target!, 0, 10);
    expect(history.events.map((event) => event.id))
      .toContain(state.archive.workspace!.id);
    expect(history.events.find((event) => event.facet === "archive")?.source)
      .toMatchObject({ sourceChainId: chainId, sourceRowId: "mark-6j-0003" });
  });

  it("should keep a mixed source chain ambiguous on every page size", async () => {
    const f = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true });
    const [mark] = await f.db.select().from(lotSourceRows)
      .where(eq(lotSourceRows.sourceId, "mark-6j-0005"));
    const full = await readLotSourceHistory(
      f.db, f.contributor.sub, f.workspaceId, mark!.chainId, 0, 10);
    expect(full.rows.map((row) => row.sourceId)).toEqual(["mark-6j-0005", "mark-6j-0006"]);
    expect(full.target).toBeNull();
    expect(full.mode).toBeNull();
    const firstPage = await readLotSourceHistory(
      f.db, f.contributor.sub, f.workspaceId, mark!.chainId, 0, 1);
    expect(firstPage.rows.map((row) => row.sourceId)).toEqual(["mark-6j-0005"]);
    expect(firstPage.target).toBeNull();
    expect(firstPage.mode).toBeNull();
    expect(firstPage.nextOffset).toBe(1);
    const secondPage = await readLotSourceHistory(
      f.db, f.contributor.sub, f.workspaceId, mark!.chainId, 1, 1);
    expect(secondPage.rows.map((row) => row.sourceId)).toEqual(["mark-6j-0006"]);
    expect(secondPage.target).toBeNull();
    expect(secondPage.mode).toBeNull();
    expect(secondPage.nextOffset).toBeNull();
  });

  it("should keep destination-less source chains ambiguous", async () => {
    const f = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true });
    const [row] = await f.db.select().from(lotSourceRows)
      .where(eq(lotSourceRows.sourceId, "mark-6j-0007"));
    const source = await readLotSourceHistory(
      f.db, f.contributor.sub, f.workspaceId, row!.chainId, 0, 10);
    expect(source.rows).toHaveLength(1);
    expect(source.target).toBeNull();
    expect(source.mode).toBeNull();
  });
});
