import { afterAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { workspaceMembershipEvents, workspaceMemberships } from "../../db/schema.js";
import { setMembershipCapability } from "./capabilities.js";
import { db, describeDb, fixture, pool } from "./db-fixture.js";
import { applyMembershipCommand } from "./membership-command.js";
import { addMembership, revokeMembership } from "./mutations.js";
import { resolveWorkspaceAccess } from "./store.js";

describeDb("atomic and serialized workspace commands", () => {
  afterAll(() => pool.end());

  it("should require new explicit capability grants after membership reactivation", async () => {
    const f = await fixture();
    const command = { workspaceId: f.workspaceId, targetAccountId: f.moderator.id,
      actorSub: f.manager.sub, reason: "synthetic" };
    const revoked = await revokeMembership(db, { ...command, expectedRevision: 2 });
    const added = await addMembership(db, { ...command, expectedRevision: revoked.revision });
    expect(added.record).toMatchObject({ status: "active", revision: 4,
      moderateArchive: false, manageMembers: false });
  });

  it("should roll back membership and earlier grants when a composite audit append fails", async () => {
    const f = await fixture();
    const trigger = `synthetic_${f.workspaceId.replaceAll("-", "")}`;
    await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic audit refusal'; END $$;
      CREATE TRIGGER ${trigger} BEFORE INSERT ON workspace_membership_events
      FOR EACH ROW WHEN (NEW.reason = 'synthetic-rollback' AND NEW.capability = 'manage_members')
      EXECUTE FUNCTION ${trigger}()`);
    try {
      await expect(applyMembershipCommand(db, { workspaceId: f.workspaceId,
        targetAccountId: f.outsider.id, actorSub: f.manager.sub, expectedRevision: null,
        reason: "synthetic-rollback", moderateArchive: true, manageMembers: true })).rejects.toThrow();
      expect(await db.select().from(workspaceMemberships)
        .where(eq(workspaceMemberships.accountId, f.outsider.id))).toEqual([]);
      expect(await db.select().from(workspaceMembershipEvents)
        .where(eq(workspaceMembershipEvents.accountId, f.outsider.id))).toEqual([]);
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON workspace_membership_events; DROP FUNCTION ${trigger}()`);
    }
  });

  it("should observe manager revocation before a queued grant on a different member", async () => {
    const f = await fixture();
    let pending: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      await setMembershipCapability(tx, { workspaceId: f.workspaceId, targetAccountId: f.manager.id,
        actorSub: f.manager.sub, reason: "synthetic revocation", expectedRevision: 2,
        capability: "manage_members", granted: false });
      pending = setMembershipCapability(db, { workspaceId: f.workspaceId, targetAccountId: f.member.id,
        actorSub: f.manager.sub, reason: "synthetic queued grant", expectedRevision: 1,
        capability: "moderate_archive", granted: true }).then(
        (result) => ({ result }), (error: unknown) => ({ error }),
      );
      await vi.waitFor(async () => {
        // Read each observation in autocommit: transaction statistics are cached.
        const rows = await pool.query(`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event = 'advisory'`);
        expect(rows.rows.length).toBeGreaterThan(0);
      }, { timeout: 2000, interval: 20 });
    });
    expect(await pending).toMatchObject({ error: { status: 403 } });
    expect(await resolveWorkspaceAccess(db, f.workspaceId, f.member.sub))
      .toMatchObject({ moderateArchive: false });
  });

  it("should conflict with the current state when an explicit-absence creation arrives late", async () => {
    const f = await fixture();
    const creation = { workspaceId: f.workspaceId, targetAccountId: f.outsider.id,
      actorSub: f.manager.sub, reason: "synthetic", expectedRevision: null };
    const results = await Promise.allSettled([addMembership(db, creation), addMembership(db, creation)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { status: 409, message: "workspace_revision_conflict",
        current: { revision: 1, accountId: f.outsider.id } },
    });
    const events = await db.select().from(workspaceMembershipEvents)
      .where(eq(workspaceMembershipEvents.accountId, f.outsider.id));
    expect(events.map((event) => event.kind)).toEqual(["member_added"]);
  });
});
