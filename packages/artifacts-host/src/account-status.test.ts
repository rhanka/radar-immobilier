import { describe, expect, it } from "vitest";
import {
  isApprovedAccountStatus,
  readAccountStatus,
  type AccountStatusQueryable,
} from "./account-status.js";

function stub(statuses: Record<string, string>) {
  const calls: Array<{ text: string; params: readonly unknown[] }> = [];
  const db: AccountStatusQueryable = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      const sub = params[0];
      const status = typeof sub === "string" ? statuses[sub] : undefined;
      return { rows: status === undefined ? [] : [{ status }] };
    },
  };
  return { db, calls };
}

describe("readAccountStatus", () => {
  it("returns the stored status for a known sub", async () => {
    const { db, calls } = stub({ "sub-1": "approved" });
    await expect(readAccountStatus(db, "sub-1")).resolves.toBe("approved");
    expect(calls).toEqual([
      {
        text: "SELECT status FROM account_users WHERE sub = $1 LIMIT 1",
        params: ["sub-1"],
      },
    ]);
  });

  it("returns null when no account row exists", async () => {
    const { db } = stub({});
    await expect(readAccountStatus(db, "unknown-sub")).resolves.toBeNull();
  });

  it("surfaces pending and rejected statuses verbatim", async () => {
    const { db } = stub({ "sub-p": "pending", "sub-r": "rejected" });
    await expect(readAccountStatus(db, "sub-p")).resolves.toBe("pending");
    await expect(readAccountStatus(db, "sub-r")).resolves.toBe("rejected");
  });
});

describe("isApprovedAccountStatus", () => {
  it("approves only the approved status", () => {
    expect(isApprovedAccountStatus("approved")).toBe(true);
    for (const status of ["pending", "rejected", "unknown", "", null]) {
      expect(isApprovedAccountStatus(status), String(status)).toBe(false);
    }
  });
});
