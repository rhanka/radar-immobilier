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
    if (row) checkRevision(toRecord(row), command.expectedRevision);
    else if (command.expectedRevision !== null) throw new WorkspaceError(400, "invalid_workspace_command");
    if (command.status === "revoked") return revokeMembership(tx, command);
    let { record } = await addMembership(tx, command);
    for (const [capability, granted] of [
      ["moderate_archive", command.moderateArchive], ["manage_members", command.manageMembers],
    ] as const) {
      if (granted === undefined) continue;
      const changed = await setMembershipCapability(tx, {
        ...command, expectedRevision: record.revision, capability, granted,
      });
      record = changed.record;
    }
    return record;
  });
}
