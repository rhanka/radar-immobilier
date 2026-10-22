import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { facetEvents, facetStreams } from "../../../db/schema.js";
import { runLotImport } from "./lot-importer.js";
import { qualifiedLotReport } from "./lot-import-input.js";
import { describeDb, lotFixture } from "./lot-fixture.js";

describeDb("6J SQL guarantees", () => {
  it("should reject missing lot modes, personal pipeline and missing values", async () => {
    const f = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report: qualifiedLotReport(), importKey: randomUUID() },
    { enabled: true });
    const [event] = await f.db.select().from(facetEvents);
    const invalid: Array<Partial<typeof facetEvents.$inferInsert>> = [
      { mode: null },
      { facet: "pipeline", pipelineStatus: null, profileId: null, reasonCode: null, verdict: null },
      { facet: "pipeline", pipelineStatus: "sollicite", profileId: null, reasonCode: null,
        verdict: null, scope: "personal", ownerId: f.moderator.id },
      { profileId: "lot-import-v1", reasonCode: "legacy-unknown", verdict: "non_pertinent",
        facet: "archive", askingPrice: null, listingUrl: null },
    ];
    for (const patch of invalid) {
      await expect(f.db.transaction(async (tx) => {
        await tx.insert(facetEvents).values({ ...event!, id: randomUUID(),
          importRunId: null, sourceAuthor: null, sourceCreatedAt: null, facet: "archive",
          profileId: "immo-steve-2026-09", reasonCode: "N-NON-RES", verdict: "non_pertinent",
          askingPrice: null, listingUrl: null, ...patch });
        throw new Error("invalid lot row accepted");
      })).rejects.toMatchObject({ cause: { code: "23514" } });
    }
    await expect(f.db.transaction(async (tx) => {
      await tx.insert(facetStreams).values({ workspaceId: f.workspaceId, scope: "workspace",
        targetType: "lot", citySlug: "synthetic-city", nodeType: "Lot", nodeId: "synthetic",
        facet: "pipeline", mode: null });
      throw new Error("invalid lot stream accepted");
    })).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("should preserve immutable source evidence", async () => {
    const f = await lotFixture();
    await runLotImport(f.db, { workspaceId: f.workspaceId,
      actorSub: f.moderator.sub, report: qualifiedLotReport(), importKey: randomUUID() },
    { enabled: true });
    for (const command of ["UPDATE lot_source_rows SET native_target = 'changed'",
      "DELETE FROM lot_source_rows", "TRUNCATE lot_source_rows"]) {
      await expect(f.pool.query(command)).rejects.toThrow("lot source evidence is immutable");
    }
  });
});
