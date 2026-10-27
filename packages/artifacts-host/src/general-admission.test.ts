import { describe, expect, it, vi } from "vitest";
import { checkAdmission, type AdmissionAuthority } from "./admission.js";
import { closed, NOW, SCOPE, stubAuthority } from "./general-harness.js";
import { HOST_ACTOR_RATE_LIMIT_PER_MINUTE, reserveArtifactAttempt } from "./attempt-admission.js";

describe("general admission without cohort or workspace", () => {
  it("admits an approved account outside any cohort with zero memberships", async () => {
    const { authority, membershipCalls } = stubAuthority({});
    await expect(checkAdmission(authority, "mallory", SCOPE)).resolves.toEqual({
      allowed: true, workspaceId: "",
    });
    expect(membershipCalls).toEqual([]);
  });

  it("admits with zero, one or two memberships and never freezes a workspace", async () => {
    for (const memberships of [[], ["w-1"], ["w-1", "w-2"]]) {
      const { authority, membershipCalls } = stubAuthority({ memberships: [memberships] });
      await expect(checkAdmission(authority, "alice", SCOPE)).resolves.toEqual({
        allowed: true, workspaceId: "",
      });
      expect(membershipCalls).toEqual([]);
    }
  });

  it("ignores a foreign scope instead of requiring a matching membership", async () => {
    const { authority, membershipCalls } = stubAuthority({ memberships: [["foreign-workspace"]] });
    await expect(checkAdmission(authority, "alice", "another-scope")).resolves.toEqual({
      allowed: true, workspaceId: "",
    });
    expect(membershipCalls).toEqual([]);
  });

  it("refuses a suspended account without touching memberships", async () => {
    const { authority, membershipCalls } = stubAuthority({ statuses: ["suspended"] });
    await expect(checkAdmission(authority, "alice", SCOPE)).resolves.toEqual(
      { allowed: false, status: 403, body: { error: "account_not_approved", status: "suspended" } });
    expect(membershipCalls).toEqual([]);
  });

  it("refuses a closed activation without touching accounts or memberships", async () => {
    const seen: string[] = [];
    const authority: AdmissionAuthority = {
      readActivation: () => closed,
      readStatus: async (sub: string) => { seen.push(sub); return "approved"; },
      nowMs: () => NOW, scope: SCOPE,
    };
    await expect(checkAdmission(authority, "alice", SCOPE)).resolves.toEqual(
      { allowed: false, status: 403, body: { error: "activation_closed" } });
    expect(seen).toEqual([]);
  });
});

describe("atomic attempt admission over a pool", () => {
  it("admits only returned reservations with server-owned scope and actor", async () => {
    expect(HOST_ACTOR_RATE_LIMIT_PER_MINUTE).toBe(10);
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ count: 10 }] }).mockResolvedValueOnce({ rows: [] });
    await expect(reserveArtifactAttempt({ query }, SCOPE, "alice")).resolves.toBe(true);
    await expect(reserveArtifactAttempt({ query }, SCOPE, "alice")).resolves.toBe(false);
    expect(query.mock.calls[0]![1]).toEqual([SCOPE, "alice", 10]);
  });

  it("fails closed when the reservation store is unavailable", async () => {
    const query = vi.fn().mockRejectedValue(new Error("private database failure"));
    await expect(reserveArtifactAttempt({ query }, SCOPE, "alice"))
      .rejects.toMatchObject({ kind: "admission_unavailable" });
  });
});
