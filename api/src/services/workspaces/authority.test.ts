/**
 * 6G authority tests: explicit grants, revisions, audit, and idempotent
 * initialization. Synthetic accounts only; no operational data.
 */
import { describe, expect, it } from "vitest";
import { WorkspaceAuthority } from "./authority.js";
import { initializeWorkspaceAuthority, type WorkspaceInitInput } from "./init.js";
import { canManageMembers, canModerateArchive, requireCapability } from "./policy.js";
import { WorkspaceError } from "./types.js";

const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function input(overrides: Partial<WorkspaceInitInput> = {}): WorkspaceInitInput {
  return {
    workspaceSlug: "synthetic-workspace",
    workspaceLabel: "Synthetic Workspace",
    approvedAccountIds: [ACTOR, MEMBER, OTHER],
    moderatorAccountIds: [ACTOR],
    managerAccountIds: [ACTOR],
    actorAccountId: ACTOR,
    reason: "synthetic initialization",
    ...overrides,
  };
}

describe("workspace authority grants", () => {
  it("should isolate two workspaces for the same account", () => {
    const authority = new WorkspaceAuthority();
    const first = authority.ensureWorkspace("synthetic-a", "Synthetic A").workspace;
    const second = authority.ensureWorkspace("synthetic-b", "Synthetic B").workspace;
    authority.addMember(first.id, MEMBER, ACTOR, "synthetic");
    expect(authority.getMembership(second.id, MEMBER)).toBeNull();
    expect(authority.listWorkspaceIds(MEMBER)).toEqual([first.id]);
  });

  it("should revoke effectively while preserving capability history", () => {
    const authority = new WorkspaceAuthority();
    const { workspace } = authority.ensureWorkspace("synthetic-a", "Synthetic A");
    authority.addMember(workspace.id, MEMBER, ACTOR, "synthetic");
    authority.setCapability(workspace.id, MEMBER, "moderate_archive", true, ACTOR, "synthetic", 1);
    authority.revokeMember(workspace.id, MEMBER, ACTOR, "synthetic", 2);
    const revoked = authority.getMembership(workspace.id, MEMBER)!;
    expect(revoked.status).toBe("revoked");
    expect(revoked.revision).toBe(3);
    expect(() => requireCapability(revoked, "moderate_archive")).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
    expect(authority.listWorkspaceIds(MEMBER)).toEqual([]);
  });

  it("should conflict on concurrent capability changes", () => {
    const authority = new WorkspaceAuthority();
    const { workspace } = authority.ensureWorkspace("synthetic-a", "Synthetic A");
    authority.addMember(workspace.id, MEMBER, ACTOR, "synthetic");
    authority.setCapability(workspace.id, MEMBER, "manage_members", true, ACTOR, "synthetic", 1);
    expect(() => authority.setCapability(
      workspace.id, MEMBER, "moderate_archive", true, ACTOR, "synthetic", 1,
    )).toThrowError(expect.objectContaining({ status: 409 }));
    const current = authority.getMembership(workspace.id, MEMBER)!;
    expect(current.revision).toBe(2);
    expect(authority.setCapability(
      workspace.id, MEMBER, "moderate_archive", true, ACTOR, "synthetic", 2,
    )).toEqual({ changed: true });
    expect(canManageMembers(authority.getMembership(workspace.id, MEMBER))).toBe(true);
    expect(canModerateArchive(authority.getMembership(workspace.id, MEMBER))).toBe(true);
  });

  it("should audit every grant and revocation exactly once", () => {
    const authority = new WorkspaceAuthority();
    const { workspace } = authority.ensureWorkspace("synthetic-a", "Synthetic A");
    authority.addMember(workspace.id, MEMBER, ACTOR, "first registration");
    authority.setCapability(workspace.id, MEMBER, "moderate_archive", true, ACTOR, "grant", 1);
    authority.setCapability(workspace.id, MEMBER, "moderate_archive", true, ACTOR, "replay", 2);
    authority.setCapability(workspace.id, MEMBER, "moderate_archive", false, ACTOR, "retract", 2);
    authority.revokeMember(workspace.id, MEMBER, ACTOR, "leave", 3);
    const kinds = authority.audit().map((event) => [event.kind, event.capability]);
    expect(kinds).toEqual([
      ["member_added", null],
      ["capability_granted", "moderate_archive"],
      ["capability_revoked", "moderate_archive"],
      ["member_revoked", null],
    ]);
    expect(authority.audit().every((event) => event.actorId === ACTOR)).toBe(true);
  });

  it("should initialize idempotently with a replay receipt", async () => {
    const authority = new WorkspaceAuthority();
    const first = await initializeWorkspaceAuthority(authority, input());
    expect(first.workspaceCreated).toBe(true);
    expect(first.membersAdded).toBe(3);
    expect(first.moderatorsGranted).toBe(1);
    expect(first.managersGranted).toBe(1);
    expect(first.replayed).toBe(false);
    expect(first.auditAppended).toBe(authority.audit().length);
    const auditLength = authority.audit().length;
    const second = await initializeWorkspaceAuthority(authority, input());
    expect(second).toMatchObject({
      workspaceId: first.workspaceId, workspaceCreated: false,
      membersAdded: 0, moderatorsGranted: 0, managersGranted: 0,
      auditAppended: 0, replayed: true,
    });
    expect(authority.audit()).toHaveLength(auditLength);
    const third = await initializeWorkspaceAuthority(authority, input({
      moderatorAccountIds: [ACTOR, MEMBER], managerAccountIds: [MEMBER],
    }));
    expect(third.replayed).toBe(false);
    expect(canModerateArchive(authority.getMembership(first.workspaceId, MEMBER))).toBe(true);
    expect(canManageMembers(authority.getMembership(first.workspaceId, MEMBER))).toBe(true);
  });

  it("should refuse initialization for unapproved references", async () => {
    const authority = new WorkspaceAuthority();
    await expect(initializeWorkspaceAuthority(authority, input({
      moderatorAccountIds: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
    }))).rejects.toMatchObject({ status: 403 });
    await expect(initializeWorkspaceAuthority(authority, input({
      actorAccountId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      approvedAccountIds: [MEMBER],
    }))).rejects.toThrowError(WorkspaceError);
  });
});
