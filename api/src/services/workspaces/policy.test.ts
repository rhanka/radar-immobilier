/**
 * 6G capability policy tests: explicit grants only. Synthetic accounts only.
 */
import { describe, expect, it } from "vitest";
import {
  canManageMembers,
  canModerateArchive,
  checkRevision,
  isActiveMember,
  requireActiveMembership,
  requireCapability,
} from "./policy.js";
import { WorkspaceError, type MembershipRecord } from "./types.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

function record(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    workspaceId: WORKSPACE_ID, accountId: ACCOUNT_ID, status: "active",
    revision: 1, moderateArchive: false, manageMembers: false, ...overrides,
  };
}

describe("workspace capability policy", () => {
  it("should refuse a nonmember without any grant", () => {
    expect(isActiveMember(null)).toBe(false);
    expect(isActiveMember(undefined)).toBe(false);
    expect(() => requireActiveMembership(null)).toThrowError(WorkspaceError);
    try {
      requireActiveMembership(null);
    } catch (error) {
      expect(error).toMatchObject({ status: 403, message: "workspace_membership_required" });
    }
  });

  it("should refuse a member without the requested capability", () => {
    const membership = record();
    expect(canModerateArchive(membership)).toBe(false);
    expect(canManageMembers(membership)).toBe(false);
    expect(() => requireCapability(membership, "moderate_archive")).toThrowError(
      expect.objectContaining({ status: 403, message: "workspace_capability_required" }),
    );
    expect(() => requireCapability(membership, "manage_members")).toThrowError(
      expect.objectContaining({ status: 403, message: "workspace_capability_required" }),
    );
  });

  it("should keep moderation and management separate in both directions", () => {
    const manager = record({ manageMembers: true });
    expect(canManageMembers(manager)).toBe(true);
    expect(canModerateArchive(manager)).toBe(false);
    expect(() => requireCapability(manager, "moderate_archive")).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
    const moderator = record({ moderateArchive: true });
    expect(canModerateArchive(moderator)).toBe(true);
    expect(canManageMembers(moderator)).toBe(false);
    expect(() => requireCapability(moderator, "manage_members")).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });

  it("should ignore any administrator flag outside the membership record", () => {
    const withoutGrant = { ...record(), isAdmin: true } as MembershipRecord & { isAdmin: boolean };
    expect(canModerateArchive(withoutGrant)).toBe(false);
    expect(canManageMembers(withoutGrant)).toBe(false);
    expect(() => requireCapability(withoutGrant, "moderate_archive")).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });

  it("should refuse a revoked membership even with stored capabilities", () => {
    const revoked = record({ status: "revoked", moderateArchive: true, manageMembers: true });
    expect(isActiveMember(revoked)).toBe(false);
    expect(() => requireActiveMembership(revoked)).toThrowError(
      expect.objectContaining({ status: 403, message: "workspace_membership_required" }),
    );
    expect(() => requireCapability(revoked, "moderate_archive")).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });

  it("should conflict on a stale revision and reject a missing one", () => {
    const current = record({ revision: 3 });
    expect(() => checkRevision(current, 2)).toThrowError(
      expect.objectContaining({ status: 409, message: "workspace_revision_conflict" }),
    );
    let conflict: unknown;
    try {
      checkRevision(current, 2);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({ status: 409, current });
    let absence: unknown;
    try {
      checkRevision(current, null);
    } catch (error) {
      absence = error;
    }
    expect(absence).toMatchObject({ status: 409, message: "workspace_revision_conflict", current });
    expect(() => checkRevision(current, undefined)).toThrowError(
      expect.objectContaining({ status: 400, message: "invalid_workspace_command" }),
    );
    expect(() => checkRevision(current, 1.5)).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
    expect(checkRevision(current, 3)).toBeUndefined();
  });
});
