import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { facetEvents, graphNodes } from "../../db/schema.js";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "./workspace-writer.js";
import { readWorkspaceArchiveState } from "./workspace-reader.js";
import { readScopedUnionDiscardedKeys } from "./workspace-discarded.js";
import { discardedSignalKey } from "../graph/discarded-signals.js";
import { describeDb, workspaceFixture, workspaceSignal } from "./workspace-archive-fixture.js";
import { targetFingerprint } from "./target.js";

describeDb("6I workspace archive authorization and O2 restore", () => {
  it("should refuse contributors and outsiders while moderators archive", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const discard = { action: "discard" as const, target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey: randomUUID() };
    await expect(writeWorkspaceArchiveFacet(f.db, f.contributor.sub, f.workspaceId, discard))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
    await expect(writeWorkspaceArchiveFacet(f.db, f.outsider.sub, f.workspaceId, discard))
      .rejects.toMatchObject({ status: 403 });
    const event = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId, discard);
    expect(event).toMatchObject({ scope: "workspace", facet: "archive", state: "active" });
    const [stored] = await f.db.select().from(facetEvents).where(eq(facetEvents.id, event!.id));
    expect(stored).toMatchObject({ scope: "workspace", ownerId: null, actorId: f.moderator.id,
      basket: null, reasonCode: "N-NON-RES" });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n).toBe(1);
  });

  it("should keep personal and workspace archives independent in both restore directions", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const personal = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const common = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const restored = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: personal!.id,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    expect(restored).toMatchObject({ state: "inactive" });
    const stillHidden = await readWorkspaceArchiveState(
      f.db, f.contributor.sub, f.workspaceId, target);
    expect(stillHidden.personal).toMatchObject({ state: "inactive" });
    expect(stillHidden.workspace).toMatchObject({ id: common!.id, state: "active" });
    expect(stillHidden.effectiveDiscarded).toBe(true);
    const reopened = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: common!.id,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    expect(reopened).toMatchObject({ state: "inactive" });
    const visible = await readWorkspaceArchiveState(
      f.db, f.contributor.sub, f.workspaceId, target);
    expect(visible).toMatchObject({ effectiveDiscarded: false });
    expect(visible.workspace).toMatchObject({ state: "inactive" });
  });

  it("should keep personal hiding when the workspace archive restores first", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const personal = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const common = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const reopened = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: common!.id,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    expect(reopened).toMatchObject({ state: "inactive" });
    const view = await readWorkspaceArchiveState(
      f.db, f.contributor.sub, f.workspaceId, target);
    expect(view.personal).toMatchObject({ id: personal!.id, state: "active" });
    expect(view.workspace).toMatchObject({ id: reopened!.id, state: "inactive" });
    expect(view.effectiveDiscarded).toBe(true);
    expect([...await readScopedUnionDiscardedKeys(f.db, f.contributor.sub, f.workspaceId)])
      .toEqual([discardedSignalKey(target.citySlug, target.type, target.id)]);
  });

  it("should conflict on stale workspace heads without leaking personal state", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const personal = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const common = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const conflict = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() })
      .then(() => { throw new Error("expected facet_head_conflict"); }, (error) => error);
    expect(conflict).toMatchObject({ status: 409, message: "facet_head_conflict" });
    expect(conflict.current.heads.map((head: { id: string }) => head.id)).toEqual([common!.id]);
    expect(conflict.current.heads.map((head: { id: string }) => head.id)).not.toContain(personal!.id);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n).toBe(2);
    const replayKey = randomUUID();
    const restored = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: common!.id,
        displayedFingerprint: fingerprint, commandKey: replayKey });
    expect(await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: common!.id,
        displayedFingerprint: fingerprint, commandKey: replayKey })).toEqual(restored);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n).toBe(3);
  });

  it("should conflict on displayed version changes without mutating", async () => {
    const f = await workspaceFixture();
    const { node, target, fingerprint } = await workspaceSignal(f);
    await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    await f.db.update(graphNodes).set({ label: "Synthetic 6I signal revised" })
      .where(eq(graphNodes.id, node.id));
    const [revised] = await f.db.select().from(graphNodes).where(eq(graphNodes.id, node.id));
    const before = (await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n;
    const conflict = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() })
      .then(() => { throw new Error("expected target_version_conflict"); }, (error) => error);
    expect(conflict).toMatchObject({ status: 409, message: "target_version_conflict",
      current: { version: { fingerprint: targetFingerprint(revised!) } } });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n).toBe(before);
  });
});
