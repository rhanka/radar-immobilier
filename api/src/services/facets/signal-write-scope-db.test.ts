// PW-B workspace scope and receipt consultation on disposable PostgreSQL:
// moderation gates, independent restores, and reads without writers.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { facetEvents } from "../../db/schema.js";
import {
  describeDb,
  workspaceFixture,
  workspaceSignal,
  type WorkspaceFixture,
} from "./workspace-archive-fixture.js";
import { readProjectionScope } from "./projection-revisions.js";
import { SIGNAL_PROJECTION_MODE } from "./projection-scope.js";
import type { SignalWriteInput } from "./signal-write-admission.js";
import { admitSyntheticWrite as coordinateSignalWrite } from "./signal-write-fixture.js";
import { unresolvedRevisionFixture } from "./projection-revisions-fixture.js";
import { readCommittedSignalReceipt } from "./signal-write-receipt.js";
import { baseState } from "./signal-write-fixture.js";
import { assertMutationOutcome, writeMutationOutcome } from "./signal-write-mutation-probe.js";

async function eventCount(f: WorkspaceFixture): Promise<number> {
  return (await f.db.select({ id: facetEvents.id }).from(facetEvents)).length;
}

async function tokenFor(f: WorkspaceFixture, sub: string, city: string): Promise<string> {
  return (await readProjectionScope(
    f.db, sub, f.workspaceId, city, SIGNAL_PROJECTION_MODE)).token;
}

async function workspaceDiscard(f: WorkspaceFixture, key = randomUUID(),
  overrides: Partial<SignalWriteInput> = {}): Promise<SignalWriteInput> {
  const { target, fingerprint } = await workspaceSignal(f);
  return {
    operation: "facets.signals.workspace.discard.v1",
    workspaceId: f.workspaceId,
    target,
    reasonCode: "N-NON-RES",
    expectedHeadId: null,
    displayedFingerprint: fingerprint,
    expectedProjectionToken: await tokenFor(f, f.moderator.sub, target.citySlug),
    commandKey: key,
    expiresAtMs: Date.now() + 60_000,
    ...overrides,
  };
}

describeDb("PW-B workspace scope and receipt reads", () => {
  it("should refuse contributors while moderators archive and restore", async () => {
    const f = await workspaceFixture();
    const refused = await workspaceDiscard(f);
    const stateBefore = await baseState(f);
    const observed = await writeMutationOutcome(coordinateSignalWrite(f.db, f.contributor.sub, {
      ...refused, expectedProjectionToken: await tokenFor(
        f, f.contributor.sub, refused.target.citySlug),
    }).then(async (result) => {
      // If authority is bypassed, every other precondition must allow a real commit.
      expect(result.event).toMatchObject({ scope: "workspace", state: "active" });
      expect((await baseState(f)).facet_commands).toHaveLength(stateBefore.facet_commands.length + 1);
      return result;
    }));
    assertMutationOutcome("authority", observed, "workspace_capability_required");
    expect(await baseState(f)).toEqual(stateBefore);
    const before = await eventCount(f);
    const committed = await coordinateSignalWrite(f.db, f.moderator.sub, refused);
    expect(committed.event).toMatchObject({ scope: "workspace", state: "active" });
    expect(await eventCount(f)).toBe(before + 1);
    const restored = await coordinateSignalWrite(f.db, f.moderator.sub, {
      ...refused, operation: "facets.signals.workspace.restore.v1",
      reasonCode: undefined, expectedHeadId: (committed.event as { id: string }).id,
      expectedProjectionToken: committed.scopeAfter, commandKey: randomUUID(),
    });
    expect(restored.event).toMatchObject({ state: "inactive" });
  });

  it("should return the committed receipt after the scope moved, with no writer", async () => {
    const f = await workspaceFixture();
    const request = await workspaceDiscard(f);
    const committed = await coordinateSignalWrite(f.db, f.moderator.sub, request);
    const next = await workspaceDiscard(f);
    await coordinateSignalWrite(f.db, f.moderator.sub, {
      ...next, expectedProjectionToken: committed.scopeAfter,
    });
    const before = await eventCount(f);
    const receipt = await readCommittedSignalReceipt(
      f.db, f.moderator.sub, f.workspaceId, request.commandKey);
    expect(receipt).toEqual(committed.event);
    expect(await eventCount(f)).toBe(before);
  });

  it("should hide receipts from outsiders and miss unknown keys as 404", async () => {
    const f = await workspaceFixture();
    const request = await workspaceDiscard(f);
    await coordinateSignalWrite(f.db, f.moderator.sub, request);
    await expect(readCommittedSignalReceipt(
      f.db, f.outsider.sub, f.workspaceId, request.commandKey))
      .rejects.toMatchObject({ status: 403 });
    await expect(readCommittedSignalReceipt(
      f.db, f.moderator.sub, f.workspaceId, randomUUID()))
      .rejects.toMatchObject({ status: 404, message: "write_intent_not_found" });
  });

  it("should block admission while personal history stays unresolved", async () => {
    const f = await unresolvedRevisionFixture();
    const target = { citySlug: "synthetic-city", type: "Signal" as const, id: randomUUID() };
    const before = await f.db.select().from(facetEvents);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, {
      operation: "facets.signals.personal.select.v1", workspaceId: f.workspaceId,
      target, basket: "pertinent", expectedHeadId: null, displayedFingerprint: "a".repeat(64),
      expectedProjectionToken: "e".repeat(64), commandKey: randomUUID(),
      expiresAtMs: Date.now() + 60_000,
    })).rejects.toMatchObject({ status: 503, message: "personal_history_unresolved" });
    expect(await f.db.select().from(facetEvents)).toEqual(before);
  });
});
