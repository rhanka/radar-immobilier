import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { facetCommands, graphNodes } from "../../db/schema.js";
import { attachPersonalHistory } from "./attachment.js";
import { runPersonalAttachmentActivation } from "./activation-run.js";
import { readScopedPersonalHeads } from "./scoped-reader.js";
import { writeScopedPersonalFacet } from "./scoped-writer.js";
import { activation, attach, describeDb, fixture, safety, type Fixture } from "./scope-db-fixture.js";
import { targetFingerprint } from "./target.js";
import type { FacetCommand } from "./writer.js";
import { writeFacet } from "./writer.js";

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
    await expect(writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId,
      { ...select, commandKey: randomUUID(), displayedFingerprint: "0".repeat(64) }))
      .rejects.toMatchObject({ status: 409, message: "target_version_conflict" });
    const inactive = await writeScopedPersonalFacet(f.db, f.member.sub, f.workspaceId,
      { ...select, action: "deselect", expectedHeadId: first!.id, commandKey: randomUUID() });
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
