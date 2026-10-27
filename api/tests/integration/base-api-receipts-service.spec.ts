import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { facetCommands, graphNodes } from "../../src/db/schema.js";
import { writeScopedPersonalFacet } from "../../src/services/facets/scoped-writer.js";
import { writeWorkspaceArchiveFacet } from "../../src/services/facets/workspace-writer.js";
import { readProjectionScope } from "../../src/services/facets/projection-revisions.js";
import { targetFingerprint } from "../../src/services/facets/target.js";
import { describeDb, workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { fixture as scopeFixture, attach, activation, safety } from "../../src/services/facets/scope-db-fixture.js";
import { runPersonalAttachmentActivation } from "../../src/services/facets/activation-run.js";

describeDb("base-api scoped receipt recovery", () => {
  it("replays the same personal command without a new event", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const command = { action: "discard" as const, target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey: randomUUID() };
    const first = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, command);
    const scopeBefore = await readProjectionScope(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, "signal");
    const eventsBefore = (await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n;
    const replay = await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, command);
    expect(replay).toEqual(first);
    const eventsAfter = (await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n;
    expect(eventsAfter).toBe(eventsBefore);
    const scopeAfter = await readProjectionScope(f.db, f.contributor.sub,
      f.workspaceId, target.citySlug, "signal");
    expect(scopeAfter.token).toBe(scopeBefore.token);
    const common = { action: "discard" as const, target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey: randomUUID() };
    const firstCommon = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId, common);
    const replayCommon = await writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId, common);
    expect(replayCommon).toEqual(firstCommon);
  });

  it("rejects the same key with a different digest", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const commandKey = randomUUID();
    const command = { action: "discard" as const, target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey };
    await writeScopedPersonalFacet(f.db, f.moderator.sub, f.workspaceId, command);
    await expect(writeScopedPersonalFacet(f.db, f.moderator.sub, f.workspaceId,
      { ...command, action: "restore" as const })).rejects.toMatchObject({
      status: 409, message: "idempotency_key_conflict" });
    await expect(writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.workspaceId, command))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
    await expect(writeScopedPersonalFacet(f.db, f.moderator.sub, f.otherId, command))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
  });

  it("keeps unresolved command contexts rejected", async () => {
    const f = await scopeFixture();
    const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
      citySlug: "synthetic-city", label: "Synthetic pending receipt" }).returning();
    const target = { citySlug: node!.citySlug, type: "Signal" as const, id: node!.id };
    const fingerprint = targetFingerprint(node!);
    const commandKey = randomUUID();
    await f.db.insert(facetCommands).values({ ownerId: f.member.id, commandKey,
      commandDigest: "b".repeat(64), result: { event: null } });
    await attach(f);
    await runPersonalAttachmentActivation(f.db, activation(f), safety);
    const command = { action: "discard" as const, target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey };
    await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, command))
      .rejects.toMatchObject({ status: 409, message: "command_context_unresolved" });
    expect(await f.db.select().from(facetCommands)).toHaveLength(1);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n).toBe(0);
  });

  it("refuses receipt recovery after membership revocation", async () => {
    const f = await workspaceFixture();
    const { target, fingerprint } = await workspaceSignal(f);
    const command = { action: "discard" as const, target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: fingerprint, commandKey: randomUUID() };
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, command);
    await f.pool.query(
      "UPDATE workspace_memberships SET status = 'revoked', revoked_at = now() WHERE workspace_id = $1 AND account_id = $2",
      [f.workspaceId, f.contributor.id]);
    await expect(writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, command))
      .rejects.toMatchObject({ status: 403 });
  });

  it("refuses writes before the scoped epoch opens", async () => {
    const f = await scopeFixture();
    const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(),
      type: "Signal", citySlug: "synthetic-city", label: "Synthetic pre-open" }).returning();
    const target = { citySlug: node!.citySlug, type: "Signal" as const, id: node!.id };
    await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, { action: "select" as const,
      basket: "pertinent" as const, target, displayedFingerprint: targetFingerprint(node!),
      expectedHeadId: null, commandKey: randomUUID() })).rejects.toMatchObject({ status: 503 });
  });
});
