/**
 * 6G operator initialization: explicit, audited, and idempotent.
 *
 * Initialization is the root of trust: the operator adds the first
 * memberships and grants directly, each audited with the operator identity
 * and a reason. Runtime membership changes go through `mutations.ts` and
 * require the management capability. Real account references arrive as
 * arguments; nothing is hardcoded here.
 */
import type { WorkspaceAuthority } from "./authority.js";
import { WorkspaceError } from "./types.js";

export interface WorkspaceInitInput {
  workspaceSlug: string;
  workspaceLabel: string;
  approvedAccountIds: string[];
  moderatorAccountIds: string[];
  managerAccountIds: string[];
  actorAccountId: string;
  reason: string;
}

export interface WorkspaceInitReceipt {
  workspaceId: string;
  workspaceCreated: boolean;
  membersAdded: number;
  moderatorsGranted: number;
  managersGranted: number;
  auditAppended: number;
  replayed: boolean;
}

export function assertInitInput(input: WorkspaceInitInput): void {
  if (!/^[a-z0-9-]+$/.test(input.workspaceSlug) || input.workspaceLabel.length === 0) {
    throw new WorkspaceError(400, "invalid_workspace_command");
  }
  if (input.reason.length === 0 || input.reason.length > 512) {
    throw new WorkspaceError(400, "invalid_workspace_command");
  }
  const approved = new Set(input.approvedAccountIds);
  for (const id of [...input.moderatorAccountIds, ...input.managerAccountIds, input.actorAccountId]) {
    if (!approved.has(id)) throw new WorkspaceError(403, "account_not_approved");
  }
}

export function toReceipt(
  workspaceId: string, workspaceCreated: boolean, membersAdded: number,
  moderatorsGranted: number, managersGranted: number,
): WorkspaceInitReceipt {
  return {
    workspaceId, workspaceCreated, membersAdded, moderatorsGranted, managersGranted,
    auditAppended: membersAdded + moderatorsGranted + managersGranted,
    replayed: !workspaceCreated && membersAdded === 0 && moderatorsGranted === 0 && managersGranted === 0,
  };
}

export async function initializeWorkspaceAuthority(
  authority: WorkspaceAuthority, input: WorkspaceInitInput,
): Promise<WorkspaceInitReceipt> {
  assertInitInput(input);
  const before = authority.audit().length;
  const { workspace, created } = authority.ensureWorkspace(input.workspaceSlug, input.workspaceLabel);
  let membersAdded = 0;
  let moderatorsGranted = 0;
  let managersGranted = 0;
  for (const accountId of new Set(input.approvedAccountIds)) {
    if (authority.addMember(workspace.id, accountId, input.actorAccountId, input.reason).changed) {
      membersAdded += 1;
    }
  }
  for (const accountId of new Set(input.moderatorAccountIds)) {
    const current = authority.getMembership(workspace.id, accountId)!;
    if (authority.setCapability(workspace.id, accountId, "moderate_archive", true,
      input.actorAccountId, input.reason, current.revision).changed) {
      moderatorsGranted += 1;
    }
  }
  for (const accountId of new Set(input.managerAccountIds)) {
    const current = authority.getMembership(workspace.id, accountId)!;
    if (authority.setCapability(workspace.id, accountId, "manage_members", true,
      input.actorAccountId, input.reason, current.revision).changed) {
      managersGranted += 1;
    }
  }
  const receipt = toReceipt(workspace.id, created, membersAdded, moderatorsGranted, managersGranted);
  receipt.auditAppended = authority.audit().length - before;
  return receipt;
}
