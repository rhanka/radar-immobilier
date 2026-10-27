// 6J importer rights: the importer needs the same distinct D4 rights as
// the commands it replaces — moderation for archive heads plus the
// selection, pipeline, or market right for the other projected heads.
// Checked before any write and before replay.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { buildLotMigrationReport } from "../lot-migration-report/report.js";
import { syntheticInput, syntheticMark } from "../lot-migration-report/fixtures.js";
import {
  facetEvents,
  lotSourceRows,
  workspaceMemberships,
} from "../../../db/schema.js";
import { setLotCapability } from "./lot-capabilities.js";
import { runLotImport } from "./lot-importer.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import {
  LOT_6J_AA,
  lot6jVersions,
  qualifiedLotReport,
} from "./lot-import-input.js";

const STAMP = "2026-01-15T10:00:00.000Z";

function singleMarkReport(statut: "favori" | "sollicite", markId: string) {
  return buildLotMigrationReport(syntheticInput(
    [syntheticMark({ id: markId, lotVersionId: LOT_6J_AA, noLot: "SYN-6J-0001",
      citySlug: "synthetic-6j-city", dimension: "pipeline", statut,
      mode: "real", authorId: "documentary-rights", createdAt: STAMP })],
    lot6jVersions(), "mapping-rights-v1", true));
}

describeDb("6J importer rights", () => {
  it("should refuse a market projection after the market right is revoked", async () => {
    const f = await lotFixture();
    await setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.moderator.id, actorSub: f.moderator.sub,
      capability: "lot_market", granted: false, reason: "synthetic market revocation",
      expectedRevision: 1 });
    await expect(runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true }))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    expect(await f.db.select().from(lotSourceRows)).toHaveLength(0);
    expect(await f.db.select().from(facetEvents)).toHaveLength(0);
  });

  it("should refuse an archive projection after moderation is revoked", async () => {
    const f = await lotFixture();
    await f.db.update(workspaceMemberships).set({ moderateArchive: false }).where(and(
      eq(workspaceMemberships.workspaceId, f.workspaceId),
      eq(workspaceMemberships.accountId, f.moderator.id)));
    await expect(runLotImport(f.db, { workspaceId: f.workspaceId,
      report: qualifiedLotReport(), actorSub: f.moderator.sub, importKey: randomUUID() },
      { enabled: true }))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    expect(await f.db.select().from(lotSourceRows)).toHaveLength(0);
    expect(await f.db.select().from(facetEvents)).toHaveLength(0);
  });

  it("should refuse a selection projection after the selection right is revoked", async () => {
    const f = await lotFixture();
    await setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.moderator.id, actorSub: f.moderator.sub,
      capability: "lot_select", granted: false, reason: "synthetic selection revocation",
      expectedRevision: 1 });
    await expect(runLotImport(f.db, { workspaceId: f.workspaceId,
      report: singleMarkReport("favori", "mark-rights-select"), actorSub: f.moderator.sub,
      importKey: randomUUID() }, { enabled: true }))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    expect(await f.db.select().from(facetEvents)).toHaveLength(0);
  });

  it("should refuse a pipeline projection after the pipeline right is revoked", async () => {
    const f = await lotFixture();
    await setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.moderator.id, actorSub: f.moderator.sub,
      capability: "lot_pipeline", granted: false, reason: "synthetic pipeline revocation",
      expectedRevision: 1 });
    await expect(runLotImport(f.db, { workspaceId: f.workspaceId,
      report: singleMarkReport("sollicite", "mark-rights-pipeline"), actorSub: f.moderator.sub,
      importKey: randomUUID() }, { enabled: true }))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    expect(await f.db.select().from(facetEvents)).toHaveLength(0);
  });

  it("should recheck rights before replaying a recorded import", async () => {
    const f = await lotFixture();
    const key = randomUUID();
    const args = { workspaceId: f.workspaceId, report: qualifiedLotReport(),
      actorSub: f.moderator.sub, importKey: key };
    await runLotImport(f.db, args, { enabled: true });
    await setLotCapability(f.db, { workspaceId: f.workspaceId,
      targetAccountId: f.moderator.id, actorSub: f.moderator.sub,
      capability: "lot_market", granted: false, reason: "synthetic replay revocation",
      expectedRevision: 1 });
    await expect(runLotImport(f.db, args, { enabled: true }))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
  });
});
