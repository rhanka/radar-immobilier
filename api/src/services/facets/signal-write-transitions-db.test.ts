import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect, baseState, admitSyntheticWrite } from "./signal-write-fixture.js";
import { readScopedPersonalHeads } from "./scoped-reader.js";
import { readWorkspaceArchiveState } from "./workspace-reader.js";
import { readProjectionScope } from "./projection-revisions.js";
import { readCommittedSignalReceipt } from "./signal-write-receipt.js";

describeDb("PW-B BASE transition reuse", () => {
  it("should compare every composite head and atomically discard both selections", async () => {
    const f = await workspaceFixture();
    const request = await preparedSelect(f);
    const first = await admitSyntheticWrite(f.db, f.contributor.sub, request);
    const second = await admitSyntheticWrite(f.db, f.contributor.sub, {
      ...request, basket: "a_surveiller", expectedProjectionToken: first.scopeAfter,
      commandKey: randomUUID(),
    });
    const discard = { ...request, operation: "facets.signals.personal.discard.v1" as const,
      basket: undefined, reasonCode: "N-NON-RES", deselect: ["pertinent", "a_surveiller"] as const,
      expectedSelectionHeads: { pertinent: first.event!.id, a_surveiller: second.event!.id },
      expectedProjectionToken: second.scopeAfter, commandKey: randomUUID() };
    const before = await baseState(f);
    await expect(admitSyntheticWrite(f.db, f.contributor.sub,
      { ...discard, deselect: [...discard.deselect], expectedSelectionHeads: {
        ...discard.expectedSelectionHeads, a_surveiller: randomUUID(),
      } })).rejects.toMatchObject({ message: "facet_head_conflict" });
    expect(await baseState(f)).toEqual(before);
    await expect(admitSyntheticWrite(f.db, f.contributor.sub, {
      ...discard, deselect: [...discard.deselect], reasonCode: "UNKNOWN-REASON",
    })).rejects.toMatchObject({ message: "invalid_reason_code" });
    expect(await baseState(f)).toEqual(before);
    const committed = await admitSyntheticWrite(f.db, f.contributor.sub,
      { ...discard, deselect: [...discard.deselect] });
    const heads = await readScopedPersonalHeads(f.db, f.contributor.sub,
      f.workspaceId, request.target.citySlug);
    expect(heads.filter((head) => head.facet === "selection").map((head) => head.state))
      .toEqual(["inactive", "inactive"]);
    expect(heads.find((head) => head.facet === "archive")?.state).toBe("active");
    expect(await readCommittedSignalReceipt(f.db, f.contributor.sub,
      f.workspaceId, discard.commandKey)).toEqual(committed.event);
    expect(Object.keys(committed.event!).sort()).toEqual(["id", "createdAt", "scope", "facet",
      "basket", "state", "reason", "observedFingerprint"].sort());
  });

  it("should deselect with BASE and preserve an independent common archive on restore", async () => {
    const f = await workspaceFixture();
    const request = await preparedSelect(f);
    const selected = await admitSyntheticWrite(f.db, f.contributor.sub, request);
    const deselected = await admitSyntheticWrite(f.db, f.contributor.sub, {
      ...request, operation: "facets.signals.personal.deselect.v1",
      expectedHeadId: selected.event!.id, expectedProjectionToken: selected.scopeAfter,
      commandKey: randomUUID(),
    });
    expect(deselected.event?.state).toBe("inactive");
    const archive = { ...request, operation: "facets.signals.personal.discard.v1" as const,
      basket: undefined, reasonCode: "N-NON-RES", expectedProjectionToken: deselected.scopeAfter,
      commandKey: randomUUID() };
    const personal = await admitSyntheticWrite(f.db, f.contributor.sub, archive);
    const scope = await readProjectionScope(f.db, f.moderator.sub,
      f.workspaceId, request.target.citySlug, "signal");
    await admitSyntheticWrite(f.db, f.moderator.sub, { ...archive,
      operation: "facets.signals.workspace.discard.v1", expectedProjectionToken: scope.token,
      commandKey: randomUUID() });
    const current = await readProjectionScope(f.db, f.contributor.sub,
      f.workspaceId, request.target.citySlug, "signal");
    await admitSyntheticWrite(f.db, f.contributor.sub, { ...request,
      operation: "facets.signals.personal.restore.v1", basket: undefined,
      expectedHeadId: personal.event!.id, expectedProjectionToken: current.token,
      commandKey: randomUUID() });
    const state = await readWorkspaceArchiveState(f.db, f.contributor.sub, f.workspaceId, request.target);
    expect(state).toMatchObject({ personal: { state: "inactive" },
      workspace: { state: "active" }, effectiveDiscarded: true });
  });
});
