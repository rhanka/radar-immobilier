// Disposable synthetic databases for 6L2 invalidation qualification.
//
// Annotated exports: this module adds no fixture of its own. It reuses
// - `describeDb`: suite gate, active only under LOT_MIGRATION_DB_TEST=1.
// - `revisionFixture`: one activated workspace with a moderator, a
//   contributor, an outsider parked in a second workspace, and both
//   workspace ids (`workspaceId` under test, `otherId` for isolation).
// - `revisionCitySignal`: a synthetic signal node in a fresh city slug,
//   with its target triple and 6B displayed fingerprint.
import { randomUUID } from "node:crypto";
import { count } from "drizzle-orm";
import { expect, it } from "vitest";
import { facetEvents } from "../../db/schema.js";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "./workspace-writer.js";
import { revokeMembership } from "../workspaces/mutations.js";
import {
  decideInvalidationTick,
  decodeInvalidationCursor,
  encodeInvalidationCursor,
  isCompatibleCursor,
  pollProjectionInvalidation,
} from "./projection-invalidation.js";
import {
  describeDb,
  revisionCitySignal,
  revisionFixture,
} from "./projection-revisions-fixture.js";

const MODE = "signal";

describeDb("6L2 invalidation isolation and revocation", () => {
  it("should invalidate every member on shared changes only", async () => {
    const f = await revisionFixture();
    const { target, fingerprint } = await revisionCitySignal(f);
    const contributor = () => pollProjectionInvalidation(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, MODE);
    const moderator = () => pollProjectionInvalidation(f.db, f.moderator.sub,
      f.workspaceId, target.citySlug, MODE);
    const contributorBefore = await contributor();
    const moderatorBefore = await moderator();
    await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const contributorAfter = await contributor();
    const moderatorAfter = await moderator();
    expect(decideInvalidationTick(contributorBefore.token, contributorAfter.token))
      .toMatchObject({ kind: "invalidated" });
    expect(decideInvalidationTick(moderatorBefore.token, moderatorAfter.token))
      .toMatchObject({ kind: "invalidated" });
  });

  it("should keep private changes invisible to other members", async () => {
    const f = await revisionFixture();
    const { target, fingerprint } = await revisionCitySignal(f);
    const moderatorBefore = await pollProjectionInvalidation(f.db, f.moderator.sub,
      f.workspaceId, target.citySlug, MODE);
    const contributorBefore = await pollProjectionInvalidation(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, MODE);
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: randomUUID() });
    const contributorAfter = await pollProjectionInvalidation(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, MODE);
    const moderatorAfter = await pollProjectionInvalidation(f.db, f.moderator.sub,
      f.workspaceId, target.citySlug, MODE);
    expect(decideInvalidationTick(contributorBefore.token, contributorAfter.token))
      .toMatchObject({ kind: "invalidated" });
    expect(decideInvalidationTick(moderatorBefore.token, moderatorAfter.token))
      .toEqual({ kind: "steady" });
  });

  it("should recheck membership on quiet cycles and close idle revoked viewers", async () => {
    const f = await revisionFixture();
    const { target } = await revisionCitySignal(f);
    const quiet = () => pollProjectionInvalidation(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, MODE);
    const first = await quiet();
    expect(decideInvalidationTick(first.token, (await quiet()).token)).toEqual({ kind: "steady" });
    const scope = await quiet();
    await revokeMembership(f.db, { workspaceId: f.workspaceId, targetAccountId: f.contributor.id,
      actorSub: f.moderator.sub, reason: "synthetic idle revocation",
      expectedRevision: scope.membershipRevision });
    await expect(quiet()).rejects.toMatchObject({ status: 403 });
  });

  it("should force resynchronization on restart and on lost cursors", async () => {
    const f = await revisionFixture();
    const { target } = await revisionCitySignal(f);
    const scope = await pollProjectionInvalidation(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, MODE);
    const live = { sub: f.contributor.sub, workspaceId: f.workspaceId,
      citySlug: target.citySlug, mode: MODE };
    const cursor = { version: 1, sub: f.contributor.sub, workspaceId: f.workspaceId,
      citySlug: target.citySlug, mode: "signal" as const, token: scope.token };
    expect(isCompatibleCursor(decodeInvalidationCursor(encodeInvalidationCursor(cursor)), live))
      .toBe(true);
    expect(isCompatibleCursor(decodeInvalidationCursor("lost"), live)).toBe(false);
    expect(isCompatibleCursor(decodeInvalidationCursor(encodeInvalidationCursor({
      ...cursor, workspaceId: f.otherId,
    })), live)).toBe(false);
    expect(decideInvalidationTick(null, scope.token)).toMatchObject({ kind: "invalidated" });
  });

  it("should authorize without appending business transitions", async () => {
    const f = await revisionFixture();
    const { target } = await revisionCitySignal(f);
    const events = async () => f.db.select({ value: count() }).from(facetEvents);
    const before = await events();
    await pollProjectionInvalidation(f.db, f.contributor.sub, f.workspaceId, target.citySlug, MODE);
    await pollProjectionInvalidation(f.db, f.moderator.sub, f.workspaceId, target.citySlug, MODE);
    expect(await events()).toEqual(before);
  });
});
