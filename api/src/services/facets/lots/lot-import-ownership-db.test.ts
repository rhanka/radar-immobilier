import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { facetEvents, facetStreams } from "../../../db/schema.js";
import { buildLotMigrationReport } from "../lot-migration-report/report.js";
import { syntheticInput } from "../lot-migration-report/fixtures.js";
import { lot6jMarks, lot6jVersions } from "./lot-import-input.js";
import { runLotImport } from "./lot-importer.js";
import { readLotState } from "./lot-reader.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor } from "./lot-test-helpers.js";

describeDb("6J documentary author isolation", () => {
  it("should keep imported ownership independent of an existing author's account", async () => {
    const f = await lotFixture();
    const marks = lot6jMarks().map((mark) => ({ ...mark, authorId: f.contributor.id }));
    const report = buildLotMigrationReport(syntheticInput(marks, lot6jVersions(), "synthetic-owner-v1", true));
    await runLotImport(f.db, { workspaceId: f.workspaceId, actorSub: f.moderator.sub,
      report, importKey: randomUUID() }, { enabled: true });
    const events = await f.db.select().from(facetEvents);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event).toMatchObject({ scope: "workspace", ownerId: null,
        sourceAuthor: f.contributor.id, actorId: f.moderator.id });
    }
    for (const stream of await f.db.select().from(facetStreams)) {
      expect(stream).toMatchObject({ scope: "workspace", ownerId: null });
    }
    const { target } = await displayedFor(f);
    const view = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target);
    expect(view.archive.workspace?.reasonCode).toBe("legacy-unknown");
    expect(view.archive.personal).toBeNull();
  });
});
