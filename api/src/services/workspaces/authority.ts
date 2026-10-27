/**
 * 6G in-memory workspace authority: reference semantics for explicit grants,
 * expected revisions, and append-only audit. The Drizzle store mirrors these
 * rules; tests exercise them here with synthetic accounts.
 */
import { randomUUID } from "node:crypto";
import {
  WorkspaceError,
  type MembershipEvent,
  type MembershipRecord,
  type WorkspaceCapability,
  type WorkspaceRef,
} from "./types.js";
import { checkRevision } from "./policy.js";

const key = (workspaceId: string, accountId: string): string =>
  `${workspaceId}:${accountId}`;

export class WorkspaceAuthority {
  private workspaces = new Map<string, WorkspaceRef>();
  private bySlug = new Map<string, string>();
  private memberships = new Map<string, MembershipRecord>();
  private events: MembershipEvent[] = [];

  ensureWorkspace(slug: string, label: string): { workspace: WorkspaceRef; created: boolean } {
    const existingId = this.bySlug.get(slug);
    if (existingId) return { workspace: this.workspaces.get(existingId)!, created: false };
    const workspace: WorkspaceRef = {
      id: randomUUID(), slug, label, scope: "all-municipalities",
    };
    this.workspaces.set(workspace.id, workspace);
    this.bySlug.set(slug, workspace.id);
    return { workspace, created: true };
  }

  getWorkspace(id: string): WorkspaceRef {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new WorkspaceError(404, "workspace_not_found");
    return workspace;
  }

  getMembership(workspaceId: string, accountId: string): MembershipRecord | null {
    this.getWorkspace(workspaceId);
    return this.memberships.get(key(workspaceId, accountId)) ?? null;
  }

  listWorkspaceIds(accountId: string): string[] {
    return [...this.memberships.values()]
      .filter((row) => row.accountId === accountId && row.status === "active")
      .map((row) => row.workspaceId)
      .sort();
  }

  audit(): readonly MembershipEvent[] {
    return this.events;
  }

  addMember(workspaceId: string, accountId: string, actorId: string, reason: string): { changed: boolean } {
    const current = this.getMembership(workspaceId, accountId);
    if (current?.status === "active") return { changed: false };
    const revision = (current?.revision ?? 0) + 1;
    this.memberships.set(key(workspaceId, accountId), {
      workspaceId, accountId, status: "active", revision,
      moderateArchive: false,
      manageMembers: false,
    });
    this.record({ workspaceId, accountId, kind: "member_added", capability: null, actorId, reason });
    return { changed: true };
  }

  revokeMember(
    workspaceId: string, accountId: string, actorId: string,
    reason: string, expectedRevision: number | null,
  ): void {
    const current = this.getMembership(workspaceId, accountId);
    if (!current || current.status !== "active") {
      throw new WorkspaceError(404, "workspace_membership_not_found");
    }
    checkRevision(current, expectedRevision);
    this.memberships.set(key(workspaceId, accountId),
      { ...current, status: "revoked", revision: current.revision + 1 });
    this.record({ workspaceId, accountId, kind: "member_revoked", capability: null, actorId, reason });
  }

  setCapability(
    workspaceId: string, accountId: string, capability: WorkspaceCapability,
    granted: boolean, actorId: string, reason: string, expectedRevision: number | null,
  ): { changed: boolean } {
    const current = this.getMembership(workspaceId, accountId);
    if (!current || current.status !== "active") {
      throw new WorkspaceError(404, "workspace_membership_not_found");
    }
    checkRevision(current, expectedRevision);
    const held = capability === "moderate_archive" ? current.moderateArchive : current.manageMembers;
    if (held === granted) return { changed: false };
    this.memberships.set(key(workspaceId, accountId), capability === "moderate_archive"
      ? { ...current, moderateArchive: granted, revision: current.revision + 1 }
      : { ...current, manageMembers: granted, revision: current.revision + 1 });
    this.record({ workspaceId, accountId,
      kind: granted ? "capability_granted" : "capability_revoked",
      capability, actorId, reason });
    return { changed: true };
  }

  private record(event: Omit<MembershipEvent, "id">): void {
    this.events.push({ ...event, id: randomUUID() });
  }
}
