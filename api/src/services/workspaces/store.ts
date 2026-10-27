/**
 * 6G Drizzle store: reads for the single workspace authority resolver.
 * Approval, membership, and capability checks live here; global
 * administration is never consulted.
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  accountUsers,
  workspaceMemberships,
  workspaces,
} from "../../db/schema.js";
import { WorkspaceError, type MembershipRecord, type WorkspaceAccess } from "./types.js";

export async function approvedAccountId(
  db: Pick<Database, "select">, sub: string, lock = false,
): Promise<string> {
  const query = db.select({ id: accountUsers.id }).from(accountUsers).where(and(
    eq(accountUsers.sub, sub), eq(accountUsers.status, "approved"),
  ));
  const [row] = await (lock ? query.for("share") : query);
  if (!row) throw new WorkspaceError(403, "account_not_approved");
  return row.id;
}

export function toRecord(row: typeof workspaceMemberships.$inferSelect): MembershipRecord {
  return {
    workspaceId: row.workspaceId,
    accountId: row.accountId,
    status: row.status === "revoked" ? "revoked" : "active",
    revision: row.revision,
    moderateArchive: row.moderateArchive,
    manageMembers: row.manageMembers,
  };
}

export async function listWorkspacesForAccount(
  db: Pick<Database, "select">, sub: string,
): Promise<WorkspaceAccess[]> {
  const accountId = await approvedAccountId(db, sub);
  const rows = await db.select({
    workspace: workspaces, membership: workspaceMemberships,
  }).from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .where(and(eq(workspaceMemberships.accountId, accountId),
      eq(workspaceMemberships.status, "active")));
  return rows.map(({ workspace, membership }) => ({
    workspace: {
      id: workspace.id, slug: workspace.slug, label: workspace.label, scope: "all-municipalities" as const,
    },
    accountId,
    moderateArchive: membership.moderateArchive,
    manageMembers: membership.manageMembers,
  }));
}

export async function resolveWorkspaceAccess(
  db: Pick<Database, "select">, workspaceId: string, sub: string,
): Promise<WorkspaceAccess> {
  const accountId = await approvedAccountId(db, sub);
  const [workspace] = await db.select().from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!workspace) throw new WorkspaceError(404, "workspace_not_found");
  const [row] = await db.select().from(workspaceMemberships).where(and(
    eq(workspaceMemberships.workspaceId, workspaceId),
    eq(workspaceMemberships.accountId, accountId),
  ));
  const membership = row ? toRecord(row) : null;
  if (membership?.status !== "active") {
    throw new WorkspaceError(403, "workspace_membership_required");
  }
  return {
    workspace: {
      id: workspace.id, slug: workspace.slug, label: workspace.label, scope: "all-municipalities" as const,
    },
    accountId,
    moderateArchive: membership.moderateArchive,
    manageMembers: membership.manageMembers,
  };
}
