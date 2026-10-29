import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { accountUsers, facetEvents } from "../../src/db/schema.js";
import { migrateDatabaseCutover, type CutoverPlan } from "../../src/scripts/database-cutover.js";
import { database, describeDb } from "../../src/services/facets/scope-db-fixture.js";
import * as readback from "../../src/services/facets/activation-readback.js";

async function seeded() {
  const f = await database();
  const actor = { id: randomUUID(), sub: `prod-actor-${randomUUID()}` };
  const member = { id: randomUUID(), sub: `prod-member-${randomUUID()}` };
  await f.db.insert(accountUsers).values([actor, member].map(a => ({ ...a, status: "approved" as const })));
  await f.db.insert(facetEvents).values({ ownerId: member.id, actorId: member.id, citySlug: "synthetic-city",
    nodeType: "Signal", nodeId: randomUUID(), facet: "selection", basket: "pertinent", state: "active",
    observedFingerprint: "a".repeat(64), commandKey: randomUUID(), commandDigest: "b".repeat(64) });
  const plan: CutoverPlan = { version: 1, actorSub: actor.sub, workspaceSlug: "approved-workspace",
    workspaceLabel: "Approved workspace", accounts: [
      { sub: actor.sub, destination: "approved-workspace", manageMembers: true, moderateArchive: true },
      { sub: member.sub, destination: "approved-workspace", manageMembers: false, moderateArchive: false }] };
  const evidence = { run: randomUUID(), release: "a".repeat(40), instances: ["old-api", "old-mcp"], completedAt: new Date().toISOString() };
  return { ...f, actor, member, plan, evidence, run: () => migrateDatabaseCutover(f.db, plan, evidence) };
}
async function snapshot(f: Awaited<ReturnType<typeof seeded>>) {
  const tables = (await f.pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  return JSON.stringify(await Promise.all(tables.map(async ({ tablename }) =>
    (await f.pool.query(`SELECT to_jsonb(t) AS row FROM "${tablename.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`)).rows)));
}
describeDb("release database cutover adapter", () => {
  it("should activate legacy data, preserve 6K state and replay scoped/open without writes", async () => {
    const f = await seeded();
    const lots = (await f.pool.query("SELECT * FROM lot_cutover_state")).rows;
    const fence = (await f.pool.query("SELECT * FROM lot_legacy_fence")).rows;
    await expect(f.run()).resolves.toMatchObject({ status: "open-success", epoch: "scoped", sealedUnresolved: 0, maintenanceBarrier: false });
    expect((await f.pool.query("SELECT * FROM lot_cutover_state")).rows).toEqual(lots);
    expect((await f.pool.query("SELECT * FROM lot_legacy_fence")).rows).toEqual(fence);
    const before = await snapshot(f);
    await f.run(); expect(await snapshot(f)).toBe(before);
  });
  it("should complete only missing partial initialization and attachment state", async () => {
    const f = await seeded();
    const ws = (await f.pool.query("INSERT INTO workspaces(slug,label) VALUES($1,$2) RETURNING id", [f.plan.workspaceSlug, f.plan.workspaceLabel])).rows[0];
    await f.pool.query("INSERT INTO workspace_memberships(workspace_id,account_id,status,revision) VALUES($1,$2,'active',1)", [ws.id, f.actor.id]);
    await expect(f.run()).resolves.toMatchObject({ status: "open-success" });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM workspace_memberships WHERE workspace_id=$1", [ws.id])).rows[0].n).toBe(2);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM facet_stream_attachments")).rows[0].n).toBe(2);
  });
  it("should forward-resume scoped/closed after interruption without rebinding history", async () => {
    const f = await seeded();
    const authorize = readback.authorizePersonalActivationReadback;
    const spy = vi.spyOn(readback, "authorizePersonalActivationReadback").mockImplementationOnce(async (...args) => {
      await authorize(...args); throw new Error("injected readback interruption");
    });
    try { await expect(f.run()).rejects.toThrow("injected"); } finally { spy.mockRestore(); }
    expect((await f.pool.query("SELECT writer_epoch,maintenance_barrier FROM facet_activation_state")).rows[0])
      .toEqual({ writer_epoch: "scoped", maintenance_barrier: true });
    const bindings = (await f.pool.query("SELECT * FROM facet_event_bindings ORDER BY event_id")).rows;
    await expect(f.run()).resolves.toMatchObject({ status: "open-success" });
    expect((await f.pool.query("SELECT * FROM facet_event_bindings ORDER BY event_id")).rows).toEqual(bindings);
  });
  it.each(["membership", "capability", "account"])("should reject revoked %s without any writes", async (right) => {
    const f = await seeded(); await f.run();
    if (right === "membership") await f.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE account_id=$1", [f.member.id]);
    if (right === "capability") await f.pool.query("UPDATE workspace_memberships SET manage_members=false WHERE account_id=$1", [f.actor.id]);
    if (right === "account") await f.pool.query("UPDATE account_users SET status='pending' WHERE id=$1", [f.member.id]);
    const before = await snapshot(f);
    await expect(f.run()).rejects.toThrow(); expect(await snapshot(f)).toBe(before);
  });
  it("should reject a preprod-IdP substitution or conflicting destination before writes", async () => {
    const f = await seeded(); const before = await snapshot(f);
    await expect(migrateDatabaseCutover(f.db, { ...f.plan, actorSub: "preprod-idp-subject" }, f.evidence)).rejects.toThrow();
    await expect(migrateDatabaseCutover(f.db, { ...f.plan, accounts: f.plan.accounts.map(a => ({ ...a, destination: "other" })) }, f.evidence)).rejects.toThrow();
    expect(await snapshot(f)).toBe(before);
  });
});
