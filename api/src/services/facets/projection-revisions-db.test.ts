import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { graphNodes, workspaceMemberships } from "../../db/schema.js";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "./workspace-writer.js";
import { readWorkspaceArchiveState } from "./workspace-reader.js";
import {
  bumpGraphSourceRevision,
  readCoherentProjection,
  readProjectionScope,
} from "./projection-revisions.js";
import {
  describeDb,
  revisionCitySignal,
  revisionFixture,
  unresolvedRevisionFixture,
} from "./projection-revisions-fixture.js";

const MODE = "signal";

describeDb("6L1 authorized revisions and coherent refetch", () => {
  it("should refuse revisions to unauthorized viewers without disclosure", async () => {
    const f = await revisionFixture();
    const city = `synthetic-6l1-${randomUUID().slice(0, 8)}`;
    await expect(readProjectionScope(f.db, f.outsider.sub, f.workspaceId, city, MODE))
      .rejects.toMatchObject({ status: 403 });
    await expect(readProjectionScope(f.db, "synthetic-unknown", f.workspaceId, city, MODE))
      .rejects.toMatchObject({ status: 403 });
    await expect(readProjectionScope(f.db, f.contributor.sub, f.workspaceId, city, "lot"))
      .rejects.toMatchObject({ status: 400 });
    await f.db.update(workspaceMemberships).set({ status: "revoked", revokedAt: new Date() })
      .where(and(eq(workspaceMemberships.workspaceId, f.workspaceId),
        eq(workspaceMemberships.accountId, f.contributor.id)));
    await expect(readProjectionScope(f.db, f.contributor.sub, f.workspaceId, city, MODE))
      .rejects.toMatchObject({ status: 403 });
  });

  it("should isolate personal revisions across members without leaking state", async () => {
    const f = await revisionFixture();
    const { target, fingerprint } = await revisionCitySignal(f);
    const before = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE);
    const moderatorBefore = await readProjectionScope(f.db, f.moderator.sub, f.workspaceId, target.citySlug, MODE);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const after = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE);
    expect(after.token).not.toBe(before.token);
    expect(after.personalRevision).toBe(before.personalRevision + 1);
    const moderatorAfter = await readProjectionScope(f.db, f.moderator.sub, f.workspaceId, target.citySlug, MODE);
    expect(moderatorAfter.token).toBe(moderatorBefore.token);
    const isolated = await readWorkspaceArchiveState(f.db, f.moderator.sub, f.workspaceId, target);
    expect(isolated.personal).toBeNull();
  });

  it("should share workspace revisions across members and ignore no-ops", async () => {
    const f = await revisionFixture();
    const { target, fingerprint } = await revisionCitySignal(f);
    const contributorBefore = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE);
    const moderatorBefore = await readProjectionScope(f.db, f.moderator.sub, f.workspaceId, target.citySlug, MODE);
    const first = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const contributorAfter = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE);
    const moderatorAfter = await readProjectionScope(f.db, f.moderator.sub, f.workspaceId, target.citySlug, MODE);
    expect(contributorAfter.token).not.toBe(contributorBefore.token);
    expect(moderatorAfter.token).not.toBe(moderatorBefore.token);
    await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: first!.id,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    expect((await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE)).token)
      .toBe(contributorAfter.token);
    expect((await readProjectionScope(f.db, f.moderator.sub, f.workspaceId, target.citySlug, MODE)).token)
      .toBe(moderatorAfter.token);
  });

  it("should track source refreshes and ignore community-only changes", async () => {
    const f = await revisionFixture();
    const { node, target } = await revisionCitySignal(f);
    const bump = () => f.db.transaction((tx) => bumpGraphSourceRevision(tx, target.citySlug));
    await bump();
    const settled = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE);
    await f.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
      citySlug: target.citySlug, label: "Synthetic 6L1 second signal" });
    const refreshed = await bump();
    expect(refreshed.revision).toBe(1);
    const changed = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE);
    expect(changed.token).not.toBe(settled.token);
    const moderatorChanged = await readProjectionScope(f.db, f.moderator.sub, f.workspaceId, target.citySlug, MODE);
    expect(moderatorChanged.sourceRevision).toBe(1);
    await f.db.update(graphNodes).set({ props: { community: 5, community_name: "c" } })
      .where(eq(graphNodes.id, node.id));
    const communityOnly = await bump();
    expect(communityOnly.revision).toBe(1);
    expect((await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE)).token)
      .toBe(changed.token);
  });

  it("should refuse coherent reads on unresolved personal history", async () => {
    const f = await unresolvedRevisionFixture();
    const target = { citySlug: "synthetic-city", type: "Signal" as const, id: randomUUID() };
    await expect(readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE))
      .rejects.toMatchObject({ status: 503, message: "personal_history_unresolved" });
    await expect(readCoherentProjection(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE,
      () => readWorkspaceArchiveState(f.db, f.contributor.sub, f.workspaceId, target)))
      .rejects.toMatchObject({ status: 503 });
    const moderator = await readProjectionScope(f.db, f.moderator.sub, f.workspaceId, target.citySlug, MODE);
    expect(moderator.token).toHaveLength(64);
  });

  it("should reload heads coherently after a revision", async () => {
    const f = await revisionFixture();
    const { target, fingerprint } = await revisionCitySignal(f);
    const stale = await readProjectionScope(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const coherent = await readCoherentProjection(f.db, f.contributor.sub, f.workspaceId,
      target.citySlug, MODE,
      () => readWorkspaceArchiveState(f.db, f.contributor.sub, f.workspaceId, target));
    expect(coherent.scope.token).not.toBe(stale.token);
    expect(coherent.payload.effectiveDiscarded).toBe(true);
    expect(coherent.payload.personal).toMatchObject({ state: "active" });
  });
});
