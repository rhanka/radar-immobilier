// PW-B admission coordinator on disposable PostgreSQL: single-transaction
// writes, idempotent replay, and typed refusals without mutation.
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
import { readCommittedSignalReceipt } from "./signal-write-receipt.js";

async function eventCount(f: WorkspaceFixture): Promise<number> {
  return (await f.db.select({ id: facetEvents.id }).from(facetEvents)).length;
}

async function selectRequest(f: WorkspaceFixture, key = randomUUID(),
  overrides: Partial<SignalWriteInput> = {}): Promise<SignalWriteInput> {
  const { target, fingerprint } = await workspaceSignal(f);
  const scope = await readProjectionScope(
    f.db, f.contributor.sub, f.workspaceId, target.citySlug, SIGNAL_PROJECTION_MODE);
  return {
    operation: "facets.signals.personal.select.v1",
    workspaceId: f.workspaceId,
    target,
    basket: "pertinent",
    expectedHeadId: null,
    displayedFingerprint: fingerprint,
    expectedProjectionToken: scope.token,
    commandKey: key,
    expiresAtMs: Date.now() + 60_000,
    ...overrides,
  };
}

describeDb("PW-B admission coordinator", () => {
  it("should commit one personal selection and consult its initial receipt", async () => {
    const f = await workspaceFixture();
    const request = await selectRequest(f);
    const before = await eventCount(f);
    const committed = await coordinateSignalWrite(f.db, f.contributor.sub, request);
    expect(committed.event).toMatchObject({ state: "active", basket: "pertinent" });
    expect(committed.scopeAfter).not.toBe(committed.scopeBefore);
    expect(await eventCount(f)).toBe(before + 1);
    const receipt = await readCommittedSignalReceipt(f.db, f.contributor.sub,
      f.workspaceId, request.commandKey);
    expect(receipt).toEqual(committed.event);
    expect(await eventCount(f)).toBe(before + 1);
  });

  it("should refuse a reused key with another body and keep every table still", async () => {
    const f = await workspaceFixture();
    const request = await selectRequest(f);
    await coordinateSignalWrite(f.db, f.contributor.sub, request);
    const before = await eventCount(f);
    const scope = await readProjectionScope(f.db, f.contributor.sub,
      f.workspaceId, request.target.citySlug, SIGNAL_PROJECTION_MODE);
    const conflict = { ...request, basket: "a_surveiller" as const,
      expectedProjectionToken: scope.token };
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, conflict))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
    expect(await eventCount(f)).toBe(before);
  });

  it("should refuse stale heads and versions without appending", async () => {
    const f = await workspaceFixture();
    const request = await selectRequest(f);
    await coordinateSignalWrite(f.db, f.contributor.sub, request);
    const before = await eventCount(f);
    const city = request.target.citySlug;
    const tokenFor = async () => (await readProjectionScope(f.db, f.contributor.sub,
      f.workspaceId, city, SIGNAL_PROJECTION_MODE)).token;
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, {
      ...request, operation: "facets.signals.personal.deselect.v1",
      expectedProjectionToken: await tokenFor(), commandKey: randomUUID(),
    })).rejects.toMatchObject({ status: 409, message: "facet_head_conflict" });
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, {
      ...request, operation: "facets.signals.personal.deselect.v1",
      displayedFingerprint: "c".repeat(64),
      expectedProjectionToken: await tokenFor(), commandKey: randomUUID(),
    })).rejects.toMatchObject({ status: 409, message: "target_version_conflict" });
    expect(await eventCount(f)).toBe(before);
  });

  it("should refuse a stale 6L1 token before any writer runs", async () => {
    const f = await workspaceFixture();
    const stale = await selectRequest(f);
    const city = stale.target.citySlug;
    const advance = await selectRequest(f);
    const scope = await readProjectionScope(f.db, f.contributor.sub,
      f.workspaceId, city, SIGNAL_PROJECTION_MODE);
    await coordinateSignalWrite(f.db, f.contributor.sub,
      { ...advance, expectedProjectionToken: scope.token });
    const before = await eventCount(f);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub,
      { ...stale, basket: "a_surveiller" as const, commandKey: randomUUID() }))
      .rejects.toMatchObject({ status: 409, message: "projection_revision_conflict" });
    expect(await eventCount(f)).toBe(before);
  });

  it("should refuse an expired admission window without touching BASE", async () => {
    const f = await workspaceFixture();
    const request = await selectRequest(f, randomUUID(), { expiresAtMs: Date.now() - 1 });
    const before = await eventCount(f);
    await expect(coordinateSignalWrite(f.db, f.contributor.sub, request))
      .rejects.toMatchObject({ status: 409, message: "challenge_expired" });
    expect(await eventCount(f)).toBe(before);
  });
});
