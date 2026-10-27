import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Database } from "../../db/client.js";
import { accountUsers, facetEvents, graphNodes } from "../../db/schema.js";
import { initializeWorkspaceStore } from "../workspaces/init-store.js";
import { addMembership } from "../workspaces/mutations.js";
import { attachPersonalHistory } from "./attachment.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";
import { database, safety } from "./scope-db-fixture.js";
import { FACET_PROFILE } from "./codebook.js";
import { targetFingerprint, type SignalTarget } from "./target.js";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "./workspace-writer.js";
import { readWorkspaceArchiveCity, readWorkspaceArchiveState } from "./workspace-reader.js";
import { readScopedUnionDiscardedKeys } from "./workspace-discarded.js";
import { discardedSignalKey } from "../graph/discarded-signals.js";
import { describeDb, workspaceFixture, workspaceSignal } from "./workspace-archive-fixture.js";

async function preCutoverSignal(db: Database, label: string): Promise<{
  target: SignalTarget; fingerprint: string;
}> {
  const [node] = await db.insert(graphNodes).values({ id: randomUUID(),
    type: "Signal", citySlug: "synthetic-city", label }).returning();
  const target: SignalTarget = { citySlug: node!.citySlug, type: "Signal", id: node!.id };
  return { target, fingerprint: targetFingerprint(node!) };
}

describeDb("6I workspace union and separated city projection", () => {
  it("should hide by union while keeping personal states viewer-private", async () => {
    const f = await workspaceFixture();
    const onlyPersonal = await workspaceSignal(f, "Synthetic 6I personal-only signal");
    const onlyCommon = await workspaceSignal(f, "Synthetic 6I common-only signal");
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target: onlyPersonal.target, reasonCode: "N-NON-RES",
        expectedHeadId: null, displayedFingerprint: onlyPersonal.fingerprint,
        commandKey: randomUUID() });
    await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target: onlyCommon.target, reasonCode: "N-NON-RES",
        expectedHeadId: null, displayedFingerprint: onlyCommon.fingerprint,
        commandKey: randomUUID() });
    const keyOf = (target: { citySlug: string; type: string; id: string }) =>
      discardedSignalKey(target.citySlug, target.type, target.id);
    const viewerUnion = await readScopedUnionDiscardedKeys(f.db, f.contributor.sub, f.workspaceId);
    expect([...viewerUnion].sort()).toEqual(
      [keyOf(onlyPersonal.target), keyOf(onlyCommon.target)].sort());
    const moderatorUnion = await readScopedUnionDiscardedKeys(f.db, f.moderator.sub, f.workspaceId);
    expect([...moderatorUnion]).toEqual([keyOf(onlyCommon.target)]);
    const moderatorCity = await readWorkspaceArchiveCity(
      f.db, f.moderator.sub, f.workspaceId, onlyPersonal.target.citySlug);
    expect(moderatorCity.map((row) => row.target)).toEqual([onlyCommon.target]);
    const moderatorView = await readWorkspaceArchiveState(
      f.db, f.moderator.sub, f.workspaceId, onlyPersonal.target);
    expect(moderatorView).toMatchObject({ personal: null, workspace: null,
      effectiveDiscarded: false });
    const viewerView = await readWorkspaceArchiveState(
      f.db, f.contributor.sub, f.workspaceId, onlyCommon.target);
    expect(viewerView).toMatchObject({ personal: null, effectiveDiscarded: true });
    expect(viewerView.workspace).toMatchObject({ state: "active" });
    await expect(readScopedUnionDiscardedKeys(f.db, f.outsider.sub, f.workspaceId))
      .rejects.toMatchObject({ status: 403 });
  });

  it("should project separated personal and workspace heads per city", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const common = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const viewerRows = await readWorkspaceArchiveCity(
      f.db, f.contributor.sub, f.workspaceId, target.citySlug);
    expect(viewerRows).toHaveLength(1);
    expect(viewerRows[0]).toMatchObject({ effectiveDiscarded: true,
      capabilities: { discardPersonally: true, moderateArchive: false } });
    expect(viewerRows[0]!.personal).toMatchObject({ state: "active" });
    expect(viewerRows[0]!.workspace).toMatchObject({ id: common!.id, state: "active" });
    const moderatorRows = await readWorkspaceArchiveCity(
      f.db, f.moderator.sub, f.workspaceId, target.citySlug);
    expect(moderatorRows).toHaveLength(1);
    expect(moderatorRows[0]).toMatchObject({ personal: null, effectiveDiscarded: true,
      capabilities: { discardPersonally: true, moderateArchive: true } });
    expect(moderatorRows[0]!.workspace).toMatchObject({ id: common!.id });
    expect(await readWorkspaceArchiveCity(
      f.db, f.contributor.sub, f.otherId, target.citySlug)).toEqual([]);
  });

  it("should refuse the union when a late-admitted account keeps unattached pre-cutover history", async () => {
    const handle = await database();
    const { db } = handle;
    const moderator = { id: randomUUID(), sub: `synthetic-moderator-${randomUUID()}` };
    const latecomer = { id: randomUUID(), sub: `synthetic-latecomer-${randomUUID()}` };
    for (const person of [moderator, latecomer]) {
      await db.insert(accountUsers).values({ ...person, status: "approved" });
    }
    const init = await initializeWorkspaceStore(db, {
      workspaceSlug: `synthetic-${randomUUID()}`, workspaceLabel: "Synthetic 6I late admission",
      approvedAccountIds: [moderator.id],
      managerAccountIds: [moderator.id], moderatorAccountIds: [moderator.id],
      actorAccountId: moderator.id, reason: "synthetic initialization",
    });
    const { target, fingerprint } = await preCutoverSignal(db, "Synthetic 6I pre-cutover signal");
    await db.insert(facetEvents).values({
      scope: "personal", ownerId: latecomer.id, actorId: latecomer.id,
      citySlug: target.citySlug, nodeType: target.type, nodeId: target.id,
      facet: "archive", basket: null, state: "active",
      profileId: FACET_PROFILE, reasonCode: "N-NON-RES", verdict: "non_pertinent",
      observedFingerprint: fingerprint, commandKey: randomUUID(), commandDigest: "e".repeat(64),
    });
    await attachPersonalHistory(db, { actorAccountId: moderator.id,
      reason: "synthetic attachment",
      entries: [{ accountId: moderator.id, workspaceId: init.workspaceId }] });
    await runPersonalAttachmentActivation(db,
      { workspaceId: init.workspaceId, actorSub: moderator.sub, reason: "synthetic activation" },
      safety);
    await addMembership(db, { workspaceId: init.workspaceId, targetAccountId: latecomer.id,
      actorSub: moderator.sub, reason: "synthetic late admission", expectedRevision: null });
    await attachPersonalHistory(db, { actorAccountId: moderator.id,
      reason: "synthetic late admission",
      entries: [{ accountId: latecomer.id, workspaceId: init.workspaceId }] });
    const common = await writeWorkspaceArchiveFacet(db, moderator.sub, init.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    expect(common).toMatchObject({ state: "active" });
    expect([...await readScopedUnionDiscardedKeys(db, moderator.sub, init.workspaceId)])
      .toEqual([discardedSignalKey(target.citySlug, target.type, target.id)]);
    await expect(readScopedUnionDiscardedKeys(db, latecomer.sub, init.workspaceId))
      .rejects.toMatchObject({ status: 503, message: "personal_history_unresolved" });
  });
});
