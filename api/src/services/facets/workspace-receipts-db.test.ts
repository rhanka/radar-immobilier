import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "./workspace-writer.js";
import { readWorkspaceArchiveState } from "./workspace-reader.js";
import { describeDb, workspaceFixture, workspaceSignal } from "./workspace-archive-fixture.js";

describeDb("6I command receipt scope", () => {
  it.each(["personal", "workspace"] as const)(
    "should reject a %s receipt reused in the other command family", async (scope) => {
      const f = await workspaceFixture();
      const { target, fingerprint } = await workspaceSignal(f);
      const command = { action: "discard" as const, target, reasonCode: "N-NON-RES",
        expectedHeadId: null, displayedFingerprint: fingerprint, commandKey: randomUUID() };
      const first = scope === "personal" ? writeScopedPersonalFacet : writeWorkspaceArchiveFacet;
      const second = scope === "personal" ? writeWorkspaceArchiveFacet : writeScopedPersonalFacet;
      await first(f.db, f.moderator.sub, f.workspaceId, command);
      await expect(second(f.db, f.moderator.sub, f.workspaceId, command))
        .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
      const view = await readWorkspaceArchiveState(f.db, f.moderator.sub, f.workspaceId, target);
      expect(scope === "personal" ? view.workspace : view.personal).toBeNull();
      expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_commands")).rows[0].n).toBe(1);
    });
});
