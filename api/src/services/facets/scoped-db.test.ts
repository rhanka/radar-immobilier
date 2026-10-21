import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { facetCommands, facetEvents, graphNodes } from "../../db/schema.js";
import { attachPersonalHistory } from "./attachment.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";
import { readScopedPersonalHeads } from "./scoped-reader.js";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { activation, attach, describeDb, fixture, safety, type Fixture } from "./scope-db-fixture.js";
import { targetFingerprint } from "./target.js";
import { historicalCommandDigest } from "./commands.js";
import type { FacetCommand } from "./writer.js";
import { writeFacet } from "./writer.js";

async function historicalReceipt(f: Fixture, kind: "pre-6A" | "6A") {
  const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
    citySlug: "synthetic-city", label: `Synthetic ${kind} signal` }).returning();
  const target = { citySlug: node!.citySlug, type: "Signal" as const, id: node!.id };
  const commandKey = randomUUID();
  const shaped = kind === "6A"
    ? { action: "select" as const, basket: "pertinent" as const, target, commandKey,
      expectedHeadId: null as string | null }
    : { action: "select" as const, basket: "pertinent" as const, target, commandKey };
  const commandDigest = historicalCommandDigest(shaped);
  const [row] = await f.db.insert(facetEvents).values({
    ownerId: f.member.id, actorId: f.member.id, citySlug: target.citySlug,
    nodeType: target.type, nodeId: target.id, facet: "selection", basket: "pertinent",
    state: "active", observedFingerprint: targetFingerprint(node!),
    commandKey, commandDigest,
  }).returning();
  const snapshot = { ...row!, createdAt: row!.createdAt.toISOString() };
  await f.db.insert(facetCommands).values({ ownerId: f.member.id, commandKey, commandDigest,
    result: { event: snapshot, ...(kind === "6A" ? { context: {
      target, facet: "selection", basket: "pertinent", expectedHeadId: null,
      expectedSelectionHeads: null } } : {}) } });
  return { node: node!, shaped, snapshot };
}

async function command(f: Fixture): Promise<FacetCommand> {
  const [node] = await f.db.insert(graphNodes).values({ id: randomUUID(), type: "Signal",
    citySlug: "synthetic-city", label: "Synthetic signal" }).returning();
  return { action: "select", basket: "pertinent", target: {
    citySlug: node!.citySlug, type: "Signal", id: node!.id },
  displayedFingerprint: targetFingerprint(node!), expectedHeadId: null, commandKey: randomUUID() };
}

describeDb("6H scoped personal commands", () => {
  it("should recover a qualified historical receipt after attachment without executing it again", async () => {
    const f = await fixture();
    const select = await command(f);
    const original = await writeFacet(f.db, f.member.sub, select);
    await attach(f);
    await runPersonalAttachmentActivation(f.db, activation(f), safety);
    expect(await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, select)).toEqual(original);
    await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, { ...select, action: "deselect" }))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n).toBe(1);
  });

  it("should allow independent heads for one account in two activated workspaces and reject stale expectations", async () => {
    const f = await fixture();
    await attach(f);
    await runPersonalAttachmentActivation(f.db, activation(f), safety);
    await attachPersonalHistory(f.db, { actorAccountId: f.actor.id, reason: "synthetic other scope",
      entries: [{ accountId: f.actor.id, workspaceId: f.otherId }] });
    await runPersonalAttachmentActivation(f.db, { ...activation(f), workspaceId: f.otherId }, safety);
    const select = await command(f);
    const first = await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, select);
    const otherCommand = { ...select, commandKey: randomUUID() };
    const second = await writeScopedPersonalFacet(f.db, f.member.sub, f.otherId, otherCommand);
    expect(first!.id).not.toBe(second!.id);
    const heads = await readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, select.target.citySlug);
    expect(heads.map((head) => head.id)).toEqual([first!.id]);
    expect((await readScopedPersonalHeads(f.db, f.member.sub, f.otherId, select.target.citySlug))
      .map((head) => head.id)).toEqual([second!.id]);
    expect(await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, select)).toEqual(first);
    await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.otherId, select))
      .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
    await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId,
      { ...select, action: "deselect", commandKey: randomUUID() }))
      .rejects.toMatchObject({ status: 409, current: { heads: [expect.objectContaining({ id: first!.id })] } });
    await f.db.update(graphNodes).set({ label: "Synthetic signal revised" })
      .where(eq(graphNodes.id, select.target.id));
    const stale = { ...select, commandKey: randomUUID() };
    const conflict = await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, stale)
      .then(() => { throw new Error("expected target version conflict"); }, (error) => error);
    expect(conflict).toMatchObject({ status: 409, message: "target_version_conflict",
      current: { heads: [expect.objectContaining({ id: first!.id })] } });
    expect((conflict.current.heads as Array<{ id: string }>).map((head) => head.id))
      .toEqual([first!.id]);
    const [revised] = await f.db.select().from(graphNodes).where(eq(graphNodes.id, select.target.id));
    const inactive = await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId,
      { ...select, action: "deselect", expectedHeadId: first!.id, commandKey: randomUUID(),
        displayedFingerprint: targetFingerprint(revised!) });
    expect(inactive).toMatchObject({ state: "inactive", supersedes: first!.id });
  });

  it("should retire selections atomically without copying the archive reason into the selections", async () => {
    const f = await fixture();
    await attach(f);
    await runPersonalAttachmentActivation(f.db, activation(f), safety);
    const select = await command(f);
    const selected = await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, select);
    const archive = await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, { ...select,
      action: "discard", basket: undefined, reasonCode: "N-NON-RES", deselect: ["pertinent"],
      expectedSelectionHeads: { pertinent: selected!.id }, commandKey: randomUUID() });
    expect(archive).toMatchObject({ facet: "archive", state: "active", scope: "personal" });
    const heads = await readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, select.target.citySlug);
    expect(heads).toEqual(expect.arrayContaining([
      expect.objectContaining({ facet: "selection", state: "inactive", reasonCode: null }),
      expect.objectContaining({ facet: "archive", state: "active", reasonCode: "N-NON-RES" }),
    ]));
    expect(await readScopedPersonalHeads(f.db, f.actor.sub, f.workspaceId, select.target.citySlug)).toEqual([]);
  });

  it("should recover exact pre-6A and 6A receipts without creating new commands", async () => {
    for (const kind of ["pre-6A", "6A"] as const) {
      const f = await fixture();
      const { shaped, snapshot } = await historicalReceipt(f, kind);
      await attach(f);
      await runPersonalAttachmentActivation(f.db, activation(f), safety);
      const before = (await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n;
      expect(await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, shaped)).toEqual(snapshot);
      expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_events")).rows[0].n).toBe(before);
      await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId,
        { ...shaped, basket: "a_surveiller" as const }))
        .rejects.toMatchObject({ status: 409, message: "idempotency_key_conflict" });
      await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId,
        { ...shaped, commandKey: randomUUID() }))
        .rejects.toMatchObject({ status: 400, message: "invalid_facet_command" });
      expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_commands")).rows[0].n).toBe(1);
    }
  });

  it.each(["pre-6A", "6A"] as const)("should recover a qualified %s receipt after its target disappears", async (kind) => {
    const f = await fixture();
    const { node, shaped, snapshot } = await historicalReceipt(f, kind);
    await attach(f);
    await runPersonalAttachmentActivation(f.db, activation(f), safety);
    await f.db.delete(graphNodes).where(eq(graphNodes.id, node.id));
    expect(await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, shaped)).toEqual(snapshot);
  });

  it.each(["pre-6A", "6A"] as const)("should refuse %s recovery after membership revocation", async (kind) => {
    const f = await fixture();
    const { shaped, snapshot } = await historicalReceipt(f, kind);
    await attach(f);
    await runPersonalAttachmentActivation(f.db, activation(f), safety);
    expect(await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, shaped)).toEqual(snapshot);
    await f.pool.query("UPDATE workspace_memberships SET status = 'revoked', revoked_at = now() WHERE workspace_id = $1 AND account_id = $2",
      [f.workspaceId, f.member.id]);
    await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, shaped))
      .rejects.toMatchObject({ status: 403 });
  });

  it("should keep null-result historical receipts pending and forbid unauthorized replay", async () => {
    const f = await fixture();
    const select = await command(f);
    await f.db.insert(facetCommands).values({ ownerId: f.member.id, commandKey: select.commandKey,
      commandDigest: "b".repeat(64), result: { event: null } });
    await attach(f);
    expect(await runPersonalAttachmentActivation(f.db, activation(f), safety)).toMatchObject({ pendingReceipts: 1 });
    await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, select))
      .rejects.toMatchObject({ status: 409, message: "command_context_unresolved" });
    const fresh = { ...select, commandKey: randomUUID() };
    await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, fresh);
    await f.pool.query("UPDATE workspace_memberships SET status = 'revoked', revoked_at = now() WHERE workspace_id = $1 AND account_id = $2",
      [f.workspaceId, f.member.id]);
    await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId, fresh))
      .rejects.toMatchObject({ status: 403 });
  });
});
