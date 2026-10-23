import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { readScopedPersonalHeads } from "../../src/services/facets/scoped-reader.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { readScopedReveal } from "../../src/services/facets/scoped-reveal.js";
import { describeDb, workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";

describeDb("base-api reveal to restore transitions", () => {
  it("restores a hidden target with the revealed version and head", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const discarded = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const revealed = await readScopedReveal(f.db, f.contributor.sub, f.workspaceId, target);
    expect(revealed.effectiveDiscarded).toBe(true);
    expect(revealed.displayedFingerprint).toBe(fingerprint);
    expect(revealed.heads.personal).toMatchObject({ id: discarded!.id, state: "active" });
    expect(revealed.signal.id).toBe(target.id);
    const restored = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: revealed.heads.personal!.id,
        displayedFingerprint: revealed.displayedFingerprint, commandKey: randomUUID() });
    expect(restored).toMatchObject({ state: "inactive" });
    const visible = await readScopedReveal(f.db, f.contributor.sub, f.workspaceId, target);
    expect(visible.effectiveDiscarded).toBe(false);
    expect(visible.heads.personal).toMatchObject({ state: "inactive" });
  });

  it("keeps common hiding when the personal archive restores", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const common = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const revealed = await readScopedReveal(f.db, f.contributor.sub, f.workspaceId, target);
    const restored = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: revealed.heads.personal!.id,
        displayedFingerprint: revealed.displayedFingerprint, commandKey: randomUUID() });
    expect(restored).toMatchObject({ state: "inactive" });
    const stillHidden = await readScopedReveal(f.db, f.contributor.sub, f.workspaceId, target);
    expect(stillHidden.heads.personal).toMatchObject({ state: "inactive" });
    expect(stillHidden.heads.workspace).toMatchObject({ id: common!.id, state: "active" });
    expect(stillHidden.effectiveDiscarded).toBe(true);
  });

  it("leaves a removed selection removed after archive restore", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const selected = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "select", basket: "pertinent", target, expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const archived = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", deselect: ["pertinent"],
        expectedHeadId: null, expectedSelectionHeads: { pertinent: selected!.id },
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    expect(archived).toMatchObject({ facet: "archive", state: "active" });
    const revealed = await readScopedReveal(f.db, f.contributor.sub, f.workspaceId, target);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "restore", target, expectedHeadId: revealed.heads.personal!.id,
        displayedFingerprint: revealed.displayedFingerprint, commandKey: randomUUID() });
    const heads = await readScopedPersonalHeads(
      f.db, f.contributor.sub, f.workspaceId, target.citySlug);
    expect(heads).toEqual(expect.arrayContaining([
      expect.objectContaining({ facet: "selection", state: "inactive", reasonCode: null }),
      expect.objectContaining({ facet: "archive", state: "inactive" }),
    ]));
  });
});
