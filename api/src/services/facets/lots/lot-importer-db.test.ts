// 6J synthetic importer: disabled gate, exact-once evidence, head-only
// projections, and exact replay.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { facetEvents, lotSourceRows } from "../../../db/schema.js";
import { readLotSourceHistory } from "./lot-history.js";
import { readLotState } from "./lot-reader.js";
import { runLotImport } from "./lot-importer.js";
import {
  describeDb,
  lotFixture,
  type LotFixture,
} from "./lot-fixture.js";
import { lot6jMarks, qualifiedLotReport } from "./lot-import-input.js";

describeDb("6J lot importer", () => {
  it("should stay disabled by default without storing or projecting anything", async () => {
    const f: LotFixture = await lotFixture();
    const receipt = await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() });
    expect(receipt.status).toBe("disabled");
    expect(receipt.counts).toEqual({ sourceRows: 0, evidenceStored: 0,
      projected: 0, alreadyProjected: 0, pending: 0 });
    expect(await f.db.select().from(lotSourceRows)).toHaveLength(0);
    expect(await f.db.select().from(facetEvents)).toHaveLength(0);
  });

  it("should store every source line exactly once across runs", async () => {
    const f: LotFixture = await lotFixture();
    const first = await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true });
    expect(first.status).toBe("complete");
    expect(first.counts.sourceRows).toBe(7);
    expect(first.counts.evidenceStored).toBe(7);
    const stored = await f.db.select().from(lotSourceRows);
    expect(stored.map((row) => row.sourceId).sort()).toEqual([
      "mark-6j-0001", "mark-6j-0002", "mark-6j-0003", "mark-6j-0004",
      "mark-6j-0005", "mark-6j-0006", "mark-6j-0007",
    ]);
    const second = await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true });
    expect(second.counts.evidenceStored).toBe(0);
    expect(second.counts.projected).toBe(0);
    expect(second.counts.alreadyProjected).toBe(2);
    expect(await f.db.select().from(lotSourceRows)).toHaveLength(7);
  });

  it("should replay exact import keys without duplicating projections", async () => {
    const f: LotFixture = await lotFixture();
    const key = randomUUID();
    const args = { workspaceId: f.workspaceId, report: qualifiedLotReport(),
      actorSub: f.moderator.sub, importKey: key };
    const first = await runLotImport(f.db, args, { enabled: true });
    const replayed = await runLotImport(f.db, args, { enabled: true });
    expect(replayed.status).toBe("replayed");
    expect(replayed.runId).toBe(first.runId);
    expect(replayed.counts).toEqual(first.counts);
    expect(replayed.pending).toEqual(first.pending);
    const events = await f.db.select().from(facetEvents);
    expect(events).toHaveLength(first.counts.projected);
  });

  it("should initialize only the qualified terminal archive from a cross-facet chain", async () => {
    const f: LotFixture = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true });
    const target = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" };
    const state = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(state.archive.workspace).toMatchObject({ state: "active",
      reasonCode: "legacy-unknown" });
    expect(state.selection).toHaveLength(0);
    expect(state.pipeline).toBeNull();
    const stored = await f.db.select().from(facetEvents);
    expect(stored).toHaveLength(2);
    const archived = stored.find((event) => event.nodeId === "lot-canonical-syn-6j-01")!;
    expect(archived).toMatchObject({ scope: "workspace", ownerId: null,
      profileId: "lot-import-v1", sourceAuthor: "documentary-author-2",
      sourceCreatedAt: new Date("2026-01-17T10:00:00.000Z") });
  });

  it("should keep the historical unknown observation unknown after import", async () => {
    const f: LotFixture = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true });
    const target = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01" };
    const state = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(state.archive.workspace?.reasonCode).toBe("legacy-unknown");
    expect(state.archive.workspace?.changedSinceArchive).toBeNull();
  });

  it("should preserve exact market values and keep full chains navigable", async () => {
    const f: LotFixture = await lotFixture();
    const report = qualifiedLotReport();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      report, actorSub: f.moderator.sub, importKey: randomUUID() }, { enabled: true });
    const target = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-02" };
    const state = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(state.market).toMatchObject({ askingPrice: "999999999999.99",
      listingUrl: "https://synthetic.invalid/annonce/6j" });
    const chain = report.rows.find((row) => row.sourceId === "mark-6j-0001")!.chainId;
    const history = await readLotSourceHistory(
      f.db, f.contributor.sub, f.workspaceId, chain, 0, 10);
    expect(history.rows.map((row) => row.sourceId)).toEqual(
      ["mark-6j-0001", "mark-6j-0002", "mark-6j-0003"]);
    expect(history.rows[0]!.observed).toMatchObject({ authorId: "documentary-author-1",
      prixDemande: null });
    expect(lot6jMarks()).toHaveLength(7);
  });
});
