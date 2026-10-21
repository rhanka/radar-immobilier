/**
 * 6G capability policy: pure checks over explicit membership records.
 *
 * Approval, invitation, and global administration are intentionally absent
 * from every signature: no flag outside the membership record can grant
 * access, moderation, or management.
 */
import {
  WorkspaceError,
  WorkspaceRevisionConflictError,
  type MembershipRecord,
  type WorkspaceCapability,
} from "./types.js";

export function isActiveMember(
  membership: MembershipRecord | null | undefined,
): boolean {
  return membership?.status === "active";
}

export function canModerateArchive(
  membership: MembershipRecord | null | undefined,
): boolean {
  return membership?.status === "active" && membership.moderateArchive === true;
}

export function canManageMembers(
  membership: MembershipRecord | null | undefined,
): boolean {
  return membership?.status === "active" && membership.manageMembers === true;
}

export function requireActiveMembership(
  membership: MembershipRecord | null | undefined,
): MembershipRecord {
  if (!isActiveMember(membership)) {
    throw new WorkspaceError(403, "workspace_membership_required");
  }
  return membership!;
}

export function requireCapability(
  membership: MembershipRecord | null | undefined,
  capability: WorkspaceCapability,
): MembershipRecord {
  const record = requireActiveMembership(membership);
  const granted =
    capability === "moderate_archive"
      ? record.moderateArchive
      : record.manageMembers;
  if (!granted) throw new WorkspaceError(403, "workspace_capability_required");
  return record;
}

export function checkRevision(
  current: MembershipRecord,
  expectedRevision: number | null,
): void {
  if (expectedRevision === null || !Number.isInteger(expectedRevision)) {
    throw new WorkspaceError(400, "invalid_workspace_command");
  }
  if (current.revision !== expectedRevision) {
    throw new WorkspaceRevisionConflictError(current);
  }
}
