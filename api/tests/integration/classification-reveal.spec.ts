import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { classificationFixture } from "./classification-fixture.js";
import { readSignalClassification } from "../../src/services/facets/classification-state.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import type { ObjectStore } from "../../src/storage/object-store.js";

describeDb("classification current state and reveal guards", () => {
  it("should require reveal and restore one scope without lifting the other or selecting", async () => {
    const f = await classificationFixture();
    const { data: d, signal: s } = f;
    const deps = { db: d.db, store: {} as ObjectStore };
    const read = (reveal = false) => readSignalClassification(deps, d.contributor.sub, d.workspaceId, { ...s.target, reveal });
    const untouched = await read();
    expect(untouched.item.readiness).toBe("ready");
    expect(untouched.item.facets.personalHistoryState).toBe("untouched");
    const command = { action: "discard" as const, target: s.target, reasonCode: "N-NON-RES", expectedHeadId: null,
      displayedFingerprint: s.fingerprint, commandKey: randomUUID() };
    const common = await writeWorkspaceArchiveFacet(d.db, d.moderator.sub, d.workspaceId, command);
    await expect(read()).rejects.toThrow("reveal_required");
    const commonOnly = await read(true);
    expect(commonOnly.item.facets.personalHistoryState).toBe("untouched");
    const personal = await writeScopedPersonalFacet(d.db, d.contributor.sub, d.workspaceId, { ...command, commandKey: randomUUID() });
    const before = await d.pool.query("SELECT count(*) FROM facet_events");
    const both = await read(true);
    expect(both.item.facets).toMatchObject({ personalHidden: true, workspaceHidden: true, effectiveHidden: true });
    expect(both.item.displayedFingerprint).toBe(s.fingerprint);
    expect((await d.pool.query("SELECT count(*) FROM facet_events")).rows).toEqual(before.rows);
    await writeScopedPersonalFacet(d.db, d.contributor.sub, d.workspaceId, {
      action: "restore", target: s.target, expectedHeadId: personal!.id, displayedFingerprint: s.fingerprint, commandKey: randomUUID(),
    });
    const restoredPersonal = await read(true);
    expect(restoredPersonal.item.facets).toMatchObject({ personalHidden: false, workspaceHidden: true, effectiveHidden: true });
    expect(restoredPersonal.item.facets.archive.personal?.state).toBe("inactive");
    await expect(read()).rejects.toThrow("reveal_required");
    await writeWorkspaceArchiveFacet(d.db, d.moderator.sub, d.workspaceId, {
      action: "restore", target: s.target, expectedHeadId: common!.id, displayedFingerprint: s.fingerprint, commandKey: randomUUID(),
    });
    const visible = await read();
    expect(visible.item.facets).toMatchObject({ personalHidden: false, workspaceHidden: false, effectiveHidden: false, personalHistoryState: "has_history" });
    expect(visible.item.facets.selection).toEqual({ pertinent: null, a_surveiller: null });
    expect(visible.snapshot.queryToken).not.toBe(untouched.snapshot.queryToken);
  });
});
