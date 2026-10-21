/**
 * 6G capability mutation: grant or revoke one capability with an expected
 * revision. Management and moderation stay distinct; a no-op (same value)
 * changes nothing and appends no audit row.
 */
import { and, eq } from "drizzle-orm";
import { workspaceMemberships } from "../../db/schema.js";
import { checkRevision } from "./policy.js";
import { toRecord } from "./store.js";
import { WorkspaceError, type MembershipRecord, type WorkspaceCapability } from "./types.js";
import {
  approvedTargetId,
  assertMutation,
  audit,
  managingActorId,
  lockWorkspace,
  revisionConflict,
  type MembershipMutation,
  type WorkspaceDb,
} from "./mutations.js";

export async function setMembershipCapability(
  db: WorkspaceDb, mutation: MembershipMutation & { capability: WorkspaceCapability; granted: boolean },
): Promise<{ record: MembershipRecord; changed: boolean }> {
  assertMutation(mutation);
  if (mutation.capability !== "moderate_archive" && mutation.capability !== "manage_members") {
    throw new WorkspaceError(400, "invalid_workspace_command");
  }
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, mutation.workspaceId);
    const actorId = await managingActorId(tx, mutation.workspaceId, mutation.actorSub);
    if (mutation.granted) await approvedTargetId(tx, mutation.targetAccountId);
    const [row] = await tx.select().from(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, mutation.workspaceId),
      eq(workspaceMemberships.accountId, mutation.targetAccountId),
    ));
    const current = row ? toRecord(row) : null;
    if (!current || current.status !== "active") {
      throw new WorkspaceError(404, "workspace_membership_not_found");
    }
    checkRevision(current, mutation.expectedRevision);
    const held = mutation.capability === "moderate_archive" ? current.moderateArchive : current.manageMembers;
    if (held === mutation.granted) return { record: current, changed: false };
    const values = mutation.capability === "moderate_archive"
      ? { moderateArchive: mutation.granted, revision: current.revision + 1 }
      : { manageMembers: mutation.granted, revision: current.revision + 1 };
    const [saved] = await tx.update(workspaceMemberships).set(values).where(and(
      eq(workspaceMemberships.workspaceId, mutation.workspaceId),
      eq(workspaceMemberships.accountId, mutation.targetAccountId),
      eq(workspaceMemberships.revision, current.revision))).returning();
    if (!saved) {
      throw await revisionConflict(tx, mutation.workspaceId, mutation.targetAccountId, current);
    }
    await audit(tx, mutation.workspaceId, mutation.targetAccountId,
      mutation.granted ? "capability_granted" : "capability_revoked",
      mutation.capability, actorId, mutation.reason);
    return { record: toRecord(saved!), changed: true };
  });
}
