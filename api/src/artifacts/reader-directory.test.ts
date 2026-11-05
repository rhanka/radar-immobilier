import { describe, expect, it, vi } from "vitest";
import {
  DIRECTORY_RESULT_LIMIT_MAX,
  maskEmail,
  resolveSubToUserRef,
  resolveUserRef,
  searchDirectory,
} from "./reader-directory.js";

const FARID = { id: "aaaaaaaa-1111-4111-8111-111111111111", sub: "idp-farid",
  name: "Farid D.", email: "farid.d@example.com" };

function poolWith(rows: unknown[]) {
  const query = vi.fn(async (_sql: string, _args: unknown[]) => ({ rows, rowCount: rows.length }));
  return { pool: { query } as never, query };
}

describe("reader directory", () => {
  it("masks the local part and keeps the domain visible", () => {
    expect(maskEmail("farid.d@example.com")).toBe("f***@example.com");
    expect(maskEmail("x@y.zz")).toBe("x***@y.zz");
    expect(maskEmail(null)).toBe("");
    expect(maskEmail("not-an-email")).toBe("");
    expect(maskEmail("a@")).toBe("");
    expect(maskEmail("@example.com")).toBe("");
  });

  it("resolves a userRef to the internal sub, approved accounts only", async () => {
    const { pool, query } = poolWith([{ id: FARID.id, sub: FARID.sub, status: "approved" }]);
    const hit = await resolveUserRef(pool, FARID.id);
    expect(hit).toMatchObject({ userRef: FARID.id, sub: FARID.sub,
      displayName: "Membre", emailHint: "" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'approved'"), [FARID.id]);
    expect(query.mock.calls[0]![0]).not.toContain("name");
    expect(query.mock.calls[0]![0]).not.toContain("email");
    expect(await resolveUserRef(pool, "not-a-uuid")).toBeNull();
    const { pool: empty } = poolWith([]);
    expect(await resolveUserRef(empty, FARID.id)).toBeNull();
  });

  it("resolves a sub to its userRef, approved accounts only", async () => {
    const { pool, query } = poolWith([{ id: FARID.id, sub: FARID.sub, status: "approved" }]);
    const hit = await resolveSubToUserRef(pool, FARID.sub);
    expect(hit).toMatchObject({ userRef: FARID.id, sub: FARID.sub,
      displayName: "Membre", emailHint: "" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'approved'"), [FARID.sub]);
    expect(query.mock.calls[0]![0]).not.toContain("name");
    expect(query.mock.calls[0]![0]).not.toContain("email");
  });

  it("fails people lookup cleanly when name/email columns are not granted", async () => {
    const denied = Object.assign(new Error('permission denied for table account_users'), { code: "42501" });
    const failing = { query: async () => { throw denied; } } as never;
    await expect(searchDirectory(failing, "farid"))
      .rejects.toMatchObject({ code: "directory_lookup_unavailable" });
  });

  it("searches approved accounts case- and accent-insensitively, capped at 10", async () => {
    const rows = [FARID,
      { id: "bbbbbbbb-2222-4222-8222-222222222222", sub: "idp-farida",
        name: "Fàrid B.", email: "farid.b@example.com" }];
    const { pool, query } = poolWith(rows);
    const matches = await searchDirectory(pool, "farid");
    expect(matches.map((m) => m.userRef)).toEqual([FARID.id, rows[1]!.id]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'approved'"),
      [expect.stringContaining("farid")]);
    const accented = await searchDirectory(pool, "fàrid");
    expect(accented).toHaveLength(2);
    expect(await searchDirectory(pool, "x")).toEqual([]);
    expect(await searchDirectory(pool, "")).toEqual([]);
  });

  it("rejects short, overlong and non-string queries without touching the database", async () => {
    const { pool, query } = poolWith([FARID]);
    expect(await searchDirectory(pool, "f")).toEqual([]);
    expect(await searchDirectory(pool, `f${"o".repeat(120)}`)).toEqual([]);
    expect(await searchDirectory(pool, null as never)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("never returns more than 10 matches", async () => {
    expect(DIRECTORY_RESULT_LIMIT_MAX).toBe(10);
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: FARID.id, sub: `idp-${i}`,
      name: `Farid ${i}`, email: `farid${i}@example.com` }));
    const { pool } = poolWith(rows);
    expect((await searchDirectory(pool, "farid", 99))).toHaveLength(10);
  });
});
