// One HTTP intention, one transaction, one caller-supplied revision check.
import { and, eq } from "drizzle-orm";
import { workspaceMemberships } from "../../db/schema.js";
import { setMembershipCapability } from "./capabilities.js";
import {
  addMembership, assertMutation, lockWorkspace, managingActorId, revokeMembership,
  type MembershipMutation, type WorkspaceDb,
} from "./mutations.js";
import { checkRevision } from "./policy.js";
import { toRecord } from "./store.js";
import { WorkspaceError, type MembershipRecord } from "./types.js";

export interface MembershipCommand extends MembershipMutation {
  status?: "active" | "revoked";
  moderateArchive?: boolean;
  manageMembers?: boolean;
}

const CAPABILITY_FIELDS = [
  ["moderate_archive", "moderateArchive"],
  ["manage_members", "manageMembers"],
] as const;

export async function applyMembershipCommand(
  db: WorkspaceDb, command: MembershipCommand,
): Promise<MembershipRecord> {
  assertMutation(command);
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, command.workspaceId);
    await managingActorId(tx, command.workspaceId, command.actorSub);
    const [row] = await tx.select().from(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, command.workspaceId),
      eq(workspaceMemberships.accountId, command.targetAccountId),
    ));
    const current = row ? toRecord(row) : null;
    if (current) checkRevision(current, command.expectedRevision);
    else if (command.expectedRevision !== null) throw new WorkspaceError(400, "invalid_workspace_command");
    if (command.status === "revoked") return revokeMembership(tx, command);
    const grants = [command.moderateArchive, command.manageMembers].some((value) => value === true);
    if (!current && command.status !== "active" && !grants) {
      // Withdrawals and bare commands never create a membership.
      throw new WorkspaceError(404, "workspace_membership_not_found");
    }
    if (command.status === "active" || !current) {
      // Explicit creation or reactivation, then the requested deltas.
      let { record } = await addMembership(tx, command);
      for (const [capability, field] of CAPABILITY_FIELDS) {
        const granted = command[field];
        if (granted === undefined) continue;
        const changed = await setMembershipCapability(tx, {
          ...command, expectedRevision: record.revision, capability, granted,
        });
        record = changed.record;
      }
      return record;
    }
    // Active membership without an explicit add status: apply the deltas on
    // the existing row. A withdrawal never reactivates a revoked membership
    // and never requires the target account to stay approved.
    let record = current;
    for (const [capability, field] of CAPABILITY_FIELDS) {
      const granted = command[field];
      if (granted === undefined) continue;
      const changed = await setMembershipCapability(tx, {
        ...command, expectedRevision: record.revision, capability, granted,
      });
      record = changed.record;
    }
    return record;
  });
}
