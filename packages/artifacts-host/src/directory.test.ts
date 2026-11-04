import { describe, expect, it } from "vitest";
import type pg from "pg";
import { createAccountDirectory, unknownUserRef } from "./directory.js";

/**
 * R1 + N3 — the directory never leaks a raw IdP sub at the model boundary,
 * in either direction:
 * - `describePrincipal` always answers: opaque `userRef` for a known
 *   account (by sub or by id), explicit `unknown-<hash>` marker for a
 *   missing one, undefined only for `sentropic:*` mode sentinels;
 * - `resolvePrincipal` answers the sub for an approved account UUID and
 *   nothing for anything else — raw sub, email, marker, pending, suspended
 *   or unknown UUID (the provider merges the miss into
 *   `person_not_shareable`; a throw would escape as a 500).
 */

const ALICE = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sub: "idp-alice",
  name: "Alice Martin", email: "alice@example.test" };
const PENDING = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sub: "idp-pending",
  name: "Pending", email: "pending@example.test" };

function stubPool() {
  const approved = [ALICE];
  return {
    async query(text: string, params: unknown[]) {
      const byId = (id: string) => [ALICE, PENDING].filter((row) => row.id === id);
      const bySub = (sub: string) => [ALICE, PENDING].filter((row) => row.sub === sub);
      // searchPeople: approved-only ledger scan.
      if (text.includes("account_users WHERE status")) return { rows: approved };
      // resolvePrincipal: approved-only lookups, by id or by sub.
      if (text.includes("status = 'approved'")) {
        const hit = text.includes("WHERE id = $1")
          ? byId(params[0] as string).filter((row) => approved.includes(row))
          : bySub(params[0] as string).filter((row) => approved.includes(row));
        return { rows: hit.map((row) => ({ sub: row.sub })) };
      }
      if (text.includes("WHERE id = $1")) return { rows: byId(params[0] as string) };
      if (text.includes("WHERE sub = $1")) return { rows: bySub(params[0] as string) };
      throw new Error(`unexpected query: ${text}`);
    },
  } as unknown as pg.Pool;
}

describe("account directory model boundary", () => {
  it("should project a known account to its opaque userRef, by sub or by id", async () => {
    const directory = createAccountDirectory(stubPool());
    const bySub = await directory.describePrincipal("scope", ALICE.sub);
    expect(bySub?.userRef).toBe(ALICE.id);
    expect(bySub?.userRef).not.toContain(ALICE.sub);
    const byId = await directory.describePrincipal("scope", ALICE.id);
    expect(byId?.userRef).toBe(ALICE.id);
  });

  it("should project a missing account to an explicit opaque unknown marker", async () => {
    const directory = createAccountDirectory(stubPool());
    const missing = await directory.describePrincipal("scope", "idp-erased-person");
    expect(missing).toBeDefined();
    expect(missing?.userRef).toMatch(/^unknown-[0-9a-f]{12}$/);
    expect(missing?.userRef).not.toContain("idp-erased-person");
    expect(missing?.displayName).toBe("Unknown reader");
    // Stable per principal, distinct per principal.
    expect((await directory.describePrincipal("scope", "idp-erased-person"))?.userRef)
      .toBe(missing?.userRef);
    expect((await directory.describePrincipal("scope", "idp-other"))?.userRef)
      .not.toBe(missing?.userRef);
    expect(unknownUserRef("idp-erased-person")).toBe(missing?.userRef);
    // The marker never resolves back to an account.
    expect(await directory.resolvePrincipal("scope", missing!.userRef)).toBeUndefined();
  });

  it("should leave mode sentinels unprojected", async () => {
    const directory = createAccountDirectory(stubPool());
    expect(await directory.describePrincipal("scope", "sentropic:platform")).toBeUndefined();
    expect(await directory.resolvePrincipal("scope", "sentropic:platform")).toBeUndefined();
  });

  it("should resolve approved account UUIDs only and yield no account for raw subs (N3)", async () => {
    const directory = createAccountDirectory(stubPool());
    expect(await directory.resolvePrincipal("scope", ALICE.id)).toBe(ALICE.sub);
    expect(await directory.resolvePrincipal("scope", PENDING.id)).toBeUndefined();
    expect(await directory.resolvePrincipal("scope", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"))
      .toBeUndefined();
    // Raw IdP subs never yield an account at the input boundary, whatever
    // the status — the miss (not a throw) is what the provider merges into
    // person_not_shareable.
    for (const sub of [ALICE.sub, PENDING.sub, "bob@example.test"]) {
      expect(await directory.resolvePrincipal("scope", sub)).toBeUndefined();
    }
    await expect(directory.resolvePrincipal("scope", ""))
      .rejects.toMatchObject({ code: "unresolvable_share_target" });
  });

  it("should search approved accounts only with opaque references", async () => {
    const directory = createAccountDirectory(stubPool());
    const matches = await directory.searchPeople("scope", "example", 10);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.userRef).toBe(ALICE.id);
    expect(JSON.stringify(matches)).not.toContain("idp-");
  });
});
