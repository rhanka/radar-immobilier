import { describe, expect, it } from "vitest";
import { checkScopeMembership } from "./admission.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

describe("scope-bound membership", () => {
  it("accepts the single bound workspace", () => {
    expect(checkScopeMembership([WORKSPACE], WORKSPACE)).toEqual({
      allowed: true, workspaceId: WORKSPACE,
    });
  });

  it("accepts case-insensitive workspace binding", () => {
    const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(checkScopeMembership([workspace.toUpperCase()], workspace)).toEqual({
      allowed: true, workspaceId: workspace,
    });
  });

  it("refuses a single foreign workspace", () => {
    expect(checkScopeMembership([SECOND], WORKSPACE)).toEqual({
      allowed: false, status: 403, body: { error: "workspace_membership_required" },
    });
  });

  it("refuses missing and ambiguous membership", () => {
    expect(checkScopeMembership([], WORKSPACE)).toMatchObject({
      allowed: false, status: 403,
    });
    expect(checkScopeMembership([WORKSPACE, SECOND], WORKSPACE)).toMatchObject({
      allowed: false, status: 409,
    });
  });

  it("keeps count-only behavior without a scope", () => {
    expect(checkScopeMembership([SECOND])).toEqual({ allowed: true, workspaceId: SECOND });
  });
});
