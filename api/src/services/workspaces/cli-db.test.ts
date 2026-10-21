import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { accountUsers, workspaceMembershipEvents } from "../../db/schema.js";
import { account, db, describeDb, pool } from "./db-fixture.js";
import { resolveWorkspaceAccess } from "./store.js";

describeDb("operator workspace initialization CLI", () => {
  afterAll(() => pool.end());

  it("should resolve synthetic subjects, audit explicit approved members and replay unchanged", async () => {
    const actor = await account();
    const moderator = await account();
    const member = await account();
    const pending = await account("pending");
    const approved = await db.select().from(accountUsers).where(eq(accountUsers.status, "approved"));
    const args = ["--workspace-slug", `synthetic-cli-${randomUUID()}`,
      "--workspace-label", "Synthetic CLI team", "--actor", actor.sub,
      "--moderator", moderator.sub, "--manager", actor.sub];
    const run = () => promisify(execFile)(process.execPath,
      ["--import", "tsx", "src/scripts/init-workspace-authority.ts", ...args]);
    const firstRun = await run();
    expect(firstRun.stderr).toBe("");
    const first = JSON.parse(firstRun.stdout);
    expect(first).toMatchObject({ workspaceCreated: true, membersAdded: approved.length,
      moderatorsGranted: 1, managersGranted: 1, auditAppended: approved.length + 2, replayed: false });
    const before = await db.select().from(workspaceMembershipEvents)
      .where(eq(workspaceMembershipEvents.workspaceId, first.workspaceId));
    const secondRun = await run();
    expect(secondRun.stderr).toBe("");
    expect(JSON.parse(secondRun.stdout)).toEqual({ workspaceId: first.workspaceId,
      workspaceCreated: false, membersAdded: 0, moderatorsGranted: 0,
      managersGranted: 0, auditAppended: 0, replayed: true });
    expect(await db.select().from(workspaceMembershipEvents)
      .where(eq(workspaceMembershipEvents.workspaceId, first.workspaceId))).toEqual(before);
    expect(await resolveWorkspaceAccess(db, first.workspaceId, member.sub))
      .toMatchObject({ moderateArchive: false, manageMembers: false });
    await expect(resolveWorkspaceAccess(db, first.workspaceId, pending.sub))
      .rejects.toMatchObject({ status: 403 });
    expect([firstRun.stdout, secondRun.stdout].every((line) =>
      !line.includes(actor.sub) && !line.includes(moderator.sub))).toBe(true);
  });
});
