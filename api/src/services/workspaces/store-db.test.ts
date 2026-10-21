import { afterAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { accountUsers, workspaceMembershipEvents, workspaceMemberships } from "../../db/schema.js";
import { setMembershipCapability } from "./capabilities.js";
import { account, db, describeDb, fixture, pool } from "./db-fixture.js";
import { initializeWorkspaceStore } from "./init-store.js";
import { addMembership, revokeMembership } from "./mutations.js";
import { requireCapability } from "./policy.js";
import { listWorkspacesForAccount, resolveWorkspaceAccess } from "./store.js";

describeDb("workspace SQL authority", () => {
  afterAll(() => pool.end());

  it("should initialize explicit memberships idempotently without broadening capabilities", async () => {
    const f = await fixture();
    expect(f.receipt).toMatchObject({ workspaceCreated: true, membersAdded: 3,
      moderatorsGranted: 1, managersGranted: 1, auditAppended: 5, replayed: false });
    const before = await db.select().from(workspaceMembershipEvents);
    const memberships = await db.select().from(workspaceMemberships);
    expect(await initializeWorkspaceStore(db, f.input)).toMatchObject({
      workspaceId: f.workspaceId, workspaceCreated: false, membersAdded: 0,
      moderatorsGranted: 0, managersGranted: 0, auditAppended: 0, replayed: true,
    });
    expect(await db.select().from(workspaceMembershipEvents)).toEqual(before);
    expect(await db.select().from(workspaceMemberships)).toEqual(memberships);
    expect(await resolveWorkspaceAccess(db, f.workspaceId, f.manager.sub))
      .toMatchObject({ moderateArchive: false, manageMembers: true });
    expect(await resolveWorkspaceAccess(db, f.workspaceId, f.moderator.sub))
      .toMatchObject({ moderateArchive: true, manageMembers: false });
    const member = await resolveWorkspaceAccess(db, f.workspaceId, f.member.sub);
    expect(member).toMatchObject({ moderateArchive: false, manageMembers: false });
    await expect(resolveWorkspaceAccess(db, f.workspaceId, f.outsider.sub))
      .rejects.toMatchObject({ status: 403 });
    expect(await listWorkspacesForAccount(db, f.outsider.sub)).toEqual([]);
  });

  it("should reject moderator and global administrator management without any write", async () => {
    const f = await fixture();
    const before = await db.select().from(workspaceMembershipEvents);
    for (const actor of [f.member, f.moderator, f.outsider]) {
      await expect(setMembershipCapability(db, { workspaceId: f.workspaceId,
        targetAccountId: f.member.id, actorSub: actor.sub, reason: "synthetic",
        expectedRevision: 1, capability: "manage_members", granted: true }))
        .rejects.toMatchObject({ status: 403 });
      await expect(addMembership(db, { workspaceId: f.workspaceId,
        targetAccountId: f.outsider.id, actorSub: actor.sub, reason: "synthetic", expectedRevision: null }))
        .rejects.toMatchObject({ status: 403 });
    }
    expect(await db.select().from(workspaceMembershipEvents)).toEqual(before);
  });

  it("should audit grants, capability revocations and membership revocation without deleting history", async () => {
    const f = await fixture();
    const mutation = { workspaceId: f.workspaceId, targetAccountId: f.member.id,
      actorSub: f.manager.sub, reason: "synthetic" };
    const grant = { ...mutation, capability: "moderate_archive" as const, granted: true, expectedRevision: 1 };
    expect((await setMembershipCapability(db, grant)).record.revision).toBe(2);
    await expect(setMembershipCapability(db, grant)).rejects.toMatchObject({ status: 409 });
    expect((await setMembershipCapability(db, { ...grant, expectedRevision: 2 })).changed).toBe(false);
    await setMembershipCapability(db, { ...grant, granted: false, expectedRevision: 2 });
    await revokeMembership(db, { ...mutation, expectedRevision: 3 });
    await expect(resolveWorkspaceAccess(db, f.workspaceId, f.member.sub)).rejects.toMatchObject({ status: 403 });
    expect(await listWorkspacesForAccount(db, f.member.sub)).toEqual([]);
    const events = await db.select().from(workspaceMembershipEvents).where(and(
      eq(workspaceMembershipEvents.workspaceId, f.workspaceId), eq(workspaceMembershipEvents.accountId, f.member.id),
    )).orderBy(workspaceMembershipEvents.createdAt);
    expect(events.map((row) => [row.kind, row.capability])).toEqual([
      ["member_added", null], ["capability_granted", "moderate_archive"],
      ["capability_revoked", "moderate_archive"], ["member_revoked", null],
    ]);
    expect(events.every((row) => row.actorId === f.manager.id && row.reason.length > 0)).toBe(true);
    await expect(pool.query("DELETE FROM account_users WHERE id = $1", [f.member.id])).rejects.toThrow();
  });

  it("should isolate workspaces and refuse suspended or pending accounts", async () => {
    const first = await fixture();
    const second = await fixture();
    await expect(resolveWorkspaceAccess(db, second.workspaceId, first.manager.sub))
      .rejects.toMatchObject({ status: 403 });
    const pending = await account("pending");
    await expect(resolveWorkspaceAccess(db, first.workspaceId, pending.sub)).rejects.toMatchObject({ status: 403 });
    await db.update(accountUsers).set({ status: "suspended" }).where(eq(accountUsers.id, first.manager.id));
    await expect(listWorkspacesForAccount(db, first.manager.sub)).rejects.toMatchObject({ status: 403 });
    await expect(initializeWorkspaceStore(db, first.input)).rejects.toMatchObject({ status: 403 });
  });

  it("should permit exactly one concurrent update of an expected revision", async () => {
    const f = await fixture();
    const mutation = { workspaceId: f.workspaceId, targetAccountId: f.member.id,
      actorSub: f.manager.sub, reason: "synthetic", granted: true, expectedRevision: 1 };
    const results = await Promise.allSettled([
      setMembershipCapability(db, { ...mutation, capability: "moderate_archive" }),
      setMembershipCapability(db, { ...mutation, capability: "manage_members" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    const access = await resolveWorkspaceAccess(db, f.workspaceId, f.member.sub);
    expect(() => requireCapability({ ...access, workspaceId: f.workspaceId, status: "active", revision: 2 },
      access.manageMembers ? "moderate_archive" : "manage_members")).toThrow();
  });
});
