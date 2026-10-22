// 6J importer dispositions: pending mixed/unqualified/unresolved
// histories stay out of the destination; D5 belongs to the 6K gate.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildLotMigrationReport } from "../lot-migration-report/report.js";
import { syntheticInput, syntheticMark } from "../lot-migration-report/fixtures.js";
import type { ManifestRow } from "../lot-migration-report/manifest.js";
import { facetEvents } from "../../../db/schema.js";
import { runLotImport } from "./lot-importer.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import {
  LOT_6J_BB,
  lot6jMarks,
  lot6jVersions,
  qualifiedLotReport,
  unqualifiedLotReport,
} from "./lot-import-input.js";

describeDb("6J lot importer dispositions", () => {
  it("should keep mixed, cross-target, and unresolved histories pending", async () => {
    const f = await lotFixture();
    const receipt = await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true });
    const byId = new Map(receipt.pending.map((entry) => [entry.sourceId, entry.cause]));
    expect(byId.get("mark-6j-0005")).toBe("conflict");
    expect(byId.get("mark-6j-0006")).toBe("conflict");
    expect(byId.get("mark-6j-0007")).toBe("unresolved");
    expect(byId.get("mark-6j-0001")).toBe("non-terminal");
    expect(byId.get("mark-6j-0002")).toBe("non-terminal");
    expect(byId.has("mark-6j-0003")).toBe(false);
    expect(byId.has("mark-6j-0004")).toBe(false);
  });

  it("should keep unqualified mappings pending without projecting", async () => {
    const f = await lotFixture();
    const receipt = await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: unqualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true });
    expect(receipt.counts.projected).toBe(0);
    expect(receipt.pending.filter((entry) => entry.cause === "destination-unqualified")
      .map((entry) => entry.sourceId).sort()).toEqual(["mark-6j-0001", "mark-6j-0002",
      "mark-6j-0003", "mark-6j-0004"]);
    expect(await f.db.select().from(facetEvents)).toHaveLength(0);
  });

  it("should refuse non-moderator importers and closed destinations", async () => {
    const f = await lotFixture();
    await expect(runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.contributor.sub, importKey: randomUUID() },
      { enabled: true })).rejects.toMatchObject({ status: 403 });
    await expect(runLotImport(f.db, { workspaceId: f.otherId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true })).rejects.toMatchObject({ status: 503 });
  });

  it("should reject reused import keys with a different manifest", async () => {
    const f = await lotFixture();
    const key = randomUUID();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: key },
      { enabled: true });
    const drifted = buildLotMigrationReport(
      syntheticInput([...lot6jMarks(), syntheticMark({ id: "mark-6j-0008",
        lotVersionId: LOT_6J_BB, noLot: "SYN-6J-0002", citySlug: "synthetic-6j-city",
        dimension: "marche", statut: "en_vente", mode: "real",
        authorId: "documentary-author-6", prixDemande: "10.00" })],
      lot6jVersions(), "mapping-syn-6j-v1", true));
    await expect(runLotImport(f.db, { workspaceId: f.workspaceId,
      report: drifted, actorSub: f.moderator.sub, importKey: key }, { enabled: true }))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
  });

  it("should document every row of the 6F correspondence source", () => {
    const report = qualifiedLotReport();
    expect(report.counts.sourceEvents).toBe(7);
    const rows = new Map<string, ManifestRow>(report.rows.map((row) => [row.sourceId, row]));
    expect(rows.get("mark-6j-0003")!.disposition).toBe("mapped");
    expect(rows.get("mark-6j-0004")!.disposition).toBe("mapped");
    expect(rows.get("mark-6j-0004")!.observed.prixDemande).toBe("999999999999.99");
    expect(rows.get("mark-6j-0007")!.disposition).toBe("unresolved");
  });

  it("should refuse changed source bytes under an already imported source ID", async () => {
    const f = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId, report: qualifiedLotReport(),
      actorSub: f.moderator.sub, importKey: randomUUID() }, { enabled: true });
    const marks = lot6jMarks().map((mark) => mark.id === "mark-6j-0004"
      ? { ...mark, prixDemande: "1.00" } : mark);
    const report = buildLotMigrationReport(syntheticInput(marks, lot6jVersions(), "mapping-syn-6j-v1", true));
    await expect(runLotImport(f.db, { workspaceId: f.workspaceId, report,
      actorSub: f.moderator.sub, importKey: randomUUID() }, { enabled: true }))
      .rejects.toMatchObject({ status: 409, message: "lot_source_evidence_conflict" });
    const events = await f.db.select().from(facetEvents);
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.facet === "market")?.askingPrice).toBe("999999999999.99");
  });
});
