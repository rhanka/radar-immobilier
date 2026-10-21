/**
 * 6G operator initialization against Postgres: same explicit steps as the
 * reference initializer, executed in one transaction with an audit row per
 * change. Idempotent: re-running with the same input changes nothing.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  accountUsers,
  workspaceMembershipEvents,
  workspaceMemberships,
  workspaces,
} from "../../db/schema.js";
import {
  assertInitInput,
  toReceipt,
  type WorkspaceInitInput,
  type WorkspaceInitReceipt,
} from "./init.js";
import { WorkspaceError } from "./types.js";
import { lockWorkspace } from "./mutations.js";

type InitTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function initAddMember(
  tx: InitTx, workspaceId: string, accountId: string, actorId: string, reason: string,
): Promise<boolean> {
  if (!UUID_PATTERN.test(accountId)) throw new WorkspaceError(400, "invalid_workspace_command");
  const [approved] = await tx.select({ id: accountUsers.id }).from(accountUsers).where(and(
    eq(accountUsers.id, accountId), eq(accountUsers.status, "approved"),
  )).for("share");
  if (!approved) throw new WorkspaceError(403, "account_not_approved");
  const [row] = await tx.select().from(workspaceMemberships).where(and(
    eq(workspaceMemberships.workspaceId, workspaceId),
    eq(workspaceMemberships.accountId, accountId),
  ));
  if (row && row.status === "active") return false;
  if (row) {
    await tx.update(workspaceMemberships).set({
      status: "active", revision: row.revision + 1,
      moderateArchive: false, manageMembers: false,
      revokedAt: null,
    }).where(and(
      eq(workspaceMemberships.workspaceId, workspaceId),
      eq(workspaceMemberships.accountId, accountId)));
  } else {
    await tx.insert(workspaceMemberships).values({
      workspaceId, accountId, status: "active", revision: 1,
      moderateArchive: false, manageMembers: false, revokedAt: null,
    });
  }
  await tx.insert(workspaceMembershipEvents).values({
    workspaceId, accountId, kind: "member_added", capability: null, actorId, reason,
  });
  return true;
}

async function initGrantCapability(
  tx: InitTx, workspaceId: string, accountId: string,
  field: "moderateArchive" | "manageMembers",
  capability: "moderate_archive" | "manage_members",
  actorId: string, reason: string,
): Promise<boolean> {
  const [row] = await tx.select().from(workspaceMemberships).where(and(
    eq(workspaceMemberships.workspaceId, workspaceId),
    eq(workspaceMemberships.accountId, accountId),
  ));
  if (!row || row.status !== "active") return false;
  if (row[field]) return false;
  const values = field === "moderateArchive"
    ? { moderateArchive: true, revision: row.revision + 1 }
    : { manageMembers: true, revision: row.revision + 1 };
  await tx.update(workspaceMemberships).set(values).where(and(
    eq(workspaceMemberships.workspaceId, workspaceId),
    eq(workspaceMemberships.accountId, accountId)));
  await tx.insert(workspaceMembershipEvents).values({
    workspaceId, accountId,
    kind: "capability_granted", capability, actorId, reason,
  });
  return true;
}

export async function initializeWorkspaceStore(
  db: Database, input: WorkspaceInitInput,
): Promise<WorkspaceInitReceipt> {
  assertInitInput(input);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('workspace-init', 0))`);
    const [existing] = await tx.select().from(workspaces).where(eq(workspaces.slug, input.workspaceSlug));
    let workspaceId: string;
    let created: boolean;
    if (existing) {
      workspaceId = existing.id;
      created = false;
    } else {
      const [inserted] = await tx.insert(workspaces)
        .values({ slug: input.workspaceSlug, label: input.workspaceLabel }).returning();
      workspaceId = inserted!.id;
      created = true;
    }
    await lockWorkspace(tx, workspaceId);
    let membersAdded = 0;
    let moderatorsGranted = 0;
    let managersGranted = 0;
    for (const accountId of new Set(input.approvedAccountIds)) {
      if (await initAddMember(tx, workspaceId, accountId, input.actorAccountId, input.reason)) {
        membersAdded += 1;
      }
    }
    for (const accountId of new Set(input.moderatorAccountIds)) {
      if (await initGrantCapability(tx, workspaceId, accountId,
        "moderateArchive", "moderate_archive", input.actorAccountId, input.reason)) {
        moderatorsGranted += 1;
      }
    }
    for (const accountId of new Set(input.managerAccountIds)) {
      if (await initGrantCapability(tx, workspaceId, accountId,
        "manageMembers", "manage_members", input.actorAccountId, input.reason)) {
        managersGranted += 1;
      }
    }
    return toReceipt(workspaceId, created, membersAdded, moderatorsGranted, managersGranted);
  });
}
