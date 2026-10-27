import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { expect, it } from "vitest";
import { facetEvents, facetEventBindings, facetHeads, facetStreams } from "../../db/schema.js";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "./workspace-writer.js";
import { describeDb, workspaceFixture, workspaceSignal } from "./workspace-archive-fixture.js";
import type { WorkspaceFixture } from "./workspace-archive-fixture.js";

async function duplicateTerminal(
  f: WorkspaceFixture, workspaceId: string, scope: "personal" | "workspace",
) {
  const { target, fingerprint } = await workspaceSignal(f, `Synthetic 6I ${scope} terminal`);
  const key = () => randomUUID();
  const head = scope === "workspace"
    ? await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: key() })
    : await writeScopedPersonalFacet(f.db, f.contributor.sub, workspaceId,
      { action: "discard", target, reasonCode: "N-NON-RES", expectedHeadId: null,
        displayedFingerprint: fingerprint, commandKey: key() });
  const actorId = scope === "workspace" ? f.moderator.id : f.contributor.id;
  const [stream] = await f.db.select().from(facetStreams).where(and(
    eq(facetStreams.workspaceId, workspaceId), eq(facetStreams.scope, scope),
    scope === "workspace" ? isNull(facetStreams.ownerId) : eq(facetStreams.ownerId, actorId),
    eq(facetStreams.citySlug, target.citySlug), eq(facetStreams.nodeType, target.type),
    eq(facetStreams.nodeId, target.id)));
  const before = (await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n;
  await expect(f.db.transaction(async (tx) => {
    const [extra] = await tx.insert(facetEvents).values({
      scope, ownerId: scope === "workspace" ? null : actorId, actorId,
      citySlug: target.citySlug, nodeType: target.type, nodeId: target.id,
      facet: "archive", basket: null, state: "active", profileId: "immo-steve-2026-09",
      reasonCode: "N-NON-RES", verdict: "non_pertinent",
      observedFingerprint: "c".repeat(64), commandKey: key(), commandDigest: "d".repeat(64),
    }).returning();
    await tx.insert(facetEventBindings).values({ eventId: extra!.id, streamId: stream!.id });
  })).rejects.toMatchObject({ cause: { message: expect.stringMatching(/exactly one terminal/) } });
  const [registered] = await f.db.select().from(facetHeads)
    .where(eq(facetHeads.streamId, stream!.id));
  expect(registered?.eventId).toBe(head!.id);
  expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n).toBe(before);
  expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_heads WHERE stream_id = $1",
    [stream!.id])).rows[0].n).toBe(1);
}

describeDb("6I duplicate terminal enforcement after the head index swap", () => {
  it.each(["personal", "workspace"] as const)(
    "should reject a second null-basket terminal in each workspace and keep the head", async (scope) => {
      const f = await workspaceFixture();
      expect((await f.pool.query(
        "SELECT to_regclass('facet_events_head_idx') AS idx")).rows[0].idx).toBeNull();
      for (const workspaceId of [f.workspaceId, f.otherId]) {
        await duplicateTerminal(f, workspaceId, scope);
      }
    });
});
