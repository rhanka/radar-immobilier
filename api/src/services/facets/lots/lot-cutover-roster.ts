import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { accountUsers, lotCapabilityGrants, workspaceMemberships, workspaces } from "../../../db/schema.js";

/** Verify concrete current identities and independently assigned D2/D4 grants. */
export async function cutoverRosterGaps(
  db: Pick<Database, "select">, workspaceId: string,
): Promise<string[]> {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!workspace) return ["workspace_not_found"];
  const members = await db.select({ membership: workspaceMemberships }).from(workspaceMemberships)
    .innerJoin(accountUsers, eq(accountUsers.id, workspaceMemberships.accountId))
    .where(and(eq(workspaceMemberships.workspaceId, workspaceId),
      eq(workspaceMemberships.status, "active"), eq(accountUsers.status, "approved")));
  const reasons: string[] = [];
  if (members.length === 0) reasons.push("workspace_members_missing");
  if (!members.some(({ membership }) => membership.moderateArchive)) reasons.push("workspace_moderator_missing");
  if (!members.some(({ membership }) => membership.manageMembers)) reasons.push("workspace_manager_missing");
  const ids = new Set(members.map(({ membership }) => membership.accountId));
  const grants = await db.select().from(lotCapabilityGrants)
    .where(eq(lotCapabilityGrants.workspaceId, workspaceId));
  for (const capability of ["lot_select", "lot_pipeline", "lot_market"]) {
    if (!grants.some((grant) => grant.capability === capability && grant.granted && ids.has(grant.accountId))) {
      reasons.push(`lot_grant_missing:${capability}`);
    }
  }
  return reasons;
}
