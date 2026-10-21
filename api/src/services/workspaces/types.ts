/** 6G workspace and membership authority: shared types. */

export type WorkspaceCapability = "moderate_archive" | "manage_members";

export type MembershipStatus = "active" | "revoked";

export type MembershipEventKind =
  | "member_added"
  | "member_revoked"
  | "capability_granted"
  | "capability_revoked";

export interface WorkspaceRef {
  id: string;
  slug: string;
  label: string;
  scope: "all-municipalities";
}

export interface MembershipRecord {
  workspaceId: string;
  accountId: string;
  status: MembershipStatus;
  revision: number;
  moderateArchive: boolean;
  manageMembers: boolean;
}

export interface MembershipEvent {
  id: string;
  workspaceId: string;
  accountId: string;
  kind: MembershipEventKind;
  capability: WorkspaceCapability | null;
  actorId: string;
  reason: string;
}

export interface WorkspaceAccess {
  workspace: WorkspaceRef;
  accountId: string;
  moderateArchive: boolean;
  manageMembers: boolean;
}

export class WorkspaceError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export class WorkspaceRevisionConflictError extends WorkspaceError {
  readonly current: MembershipRecord;
  constructor(current: MembershipRecord) {
    super(409, "workspace_revision_conflict");
    this.name = "WorkspaceRevisionConflictError";
    this.current = current;
  }
}
