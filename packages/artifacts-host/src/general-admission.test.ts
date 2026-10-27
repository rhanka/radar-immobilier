import { describe, expect, it } from "vitest";
import { checkAdmission, createArtifactAdmissionAuthority, type AdmissionAuthority } from "./admission.js";
import { closed, general, NOW, SCOPE, stubAuthority } from "./general-harness.js";
import { HOST_ACTOR_RATE_LIMIT_PER_MINUTE } from "./commit-policy.js";

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

describe("admission rate probe over a pool", () => {
  function rateAuthority(count: string | null, scope: string | undefined = SCOPE) {
    const calls: Array<{ text: string; params: unknown[] }> = [];
    const accounts = {
      async query(text: string, params: unknown[] = []) {
        calls.push({ text, params });
        if (text.includes("host_actor_rate")) return { rows: count === null ? [] : [{ count, status: "approved" }] };
        return { rows: [{ status: "approved" }] };
      },
    };
    return { authority: createArtifactAdmissionAuthority(accounts, () => general(), scope), calls };
  }

  it("reports limited at the ceiling and open below it", async () => {
    expect(HOST_ACTOR_RATE_LIMIT_PER_MINUTE).toBe(10);
    await expect(rateAuthority("10").authority.checkRate!("alice")).resolves.toBe(true);
    await expect(rateAuthority("9").authority.checkRate!("alice")).resolves.toBe(false);
    await expect(rateAuthority(null).authority.checkRate!("alice")).resolves.toBe(false);
  });

  it("scopes the probe to the storage scope", async () => {
    const { authority, calls } = rateAuthority("0");
    await expect(authority.checkRate!("alice")).resolves.toBe(false);
    expect(calls).toEqual([{ text: expect.stringContaining("host_actor_rate"), params: [SCOPE, "alice"] }]);
  });
});
