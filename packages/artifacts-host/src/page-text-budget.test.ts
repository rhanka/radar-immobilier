import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_TEXT_BUDGET, PAGE_TEXT_DEFAULT_MAX_BYTES, PAGE_TEXT_SYSTEM_MAX_BYTES,
  readPageTextBudget } from "./page-text-budget.js";
import { assertPageTextUploadArgs } from "./p0b-profile.js";

const MIB = 1024 * 1024;

function db(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ text: string; params: unknown[] | undefined }> = [];
  return { calls, query: async (text: string, params?: unknown[]) => { calls.push({ text, params }); return { rows }; } };
}

describe("page-text budget", () => {
  it("keeps the 5 MiB default and the 10 MiB system maximum", () => {
    expect(PAGE_TEXT_DEFAULT_MAX_BYTES).toBe(5 * MIB);
    expect(PAGE_TEXT_SYSTEM_MAX_BYTES).toBe(10 * MIB);
    expect(DEFAULT_PAGE_TEXT_BUDGET).toEqual({ maxFileBytes: 5 * MIB, maxTotalBytes: 5 * MIB,
      source: "default", expiresAt: null });
  });

  it("returns the default without an active exception and binds scope and actor", async () => {
    const fake = db([]);
    await expect(readPageTextBudget(fake, "scope-a", "actor-1")).resolves.toBe(DEFAULT_PAGE_TEXT_BUDGET);
    expect(fake.calls[0]!.params).toEqual(["scope-a", "actor-1"]);
    expect(fake.calls[0]!.text).toContain("expires_at IS NULL OR expires_at > now()");
  });

  it("returns an active exception and clamps it to the system maximum", async () => {
    const expires = new Date("2027-01-01T00:00:00.000Z");
    await expect(readPageTextBudget(db([{ max_bytes: String(10 * MIB), expires_at: expires }]), "s", "a"))
      .resolves.toEqual({ maxFileBytes: 10 * MIB, maxTotalBytes: 10 * MIB, source: "exception",
        expiresAt: "2027-01-01T00:00:00.000Z" });
    await expect(readPageTextBudget(db([{ max_bytes: String(64 * MIB), expires_at: null }]), "s", "a"))
      .resolves.toMatchObject({ maxFileBytes: 10 * MIB, expiresAt: null });
  });

  it("never lowers the default and never queries for an anonymous actor", async () => {
    await expect(readPageTextBudget(db([{ max_bytes: "1024", expires_at: null }]), "s", "a"))
      .resolves.toBe(DEFAULT_PAGE_TEXT_BUDGET);
    const fake = db([{ max_bytes: String(10 * MIB), expires_at: null }]);
    await expect(readPageTextBudget(fake, "s", "")).resolves.toBe(DEFAULT_PAGE_TEXT_BUDGET);
    expect(fake.calls).toHaveLength(0);
  });

  it("propagates read errors (fail closed, never widened)", async () => {
    const failing = { query: async () => { throw new Error("db down"); } };
    await expect(readPageTextBudget(failing, "s", "a")).rejects.toThrow("db down");
  });

  it("applies the effective budget per file and per release text total", () => {
    const tenMib = { maxFileBytes: 10 * MIB, maxTotalBytes: 10 * MIB };
    const upload = { mimeType: "text/html", maxSize: 6 * MIB };
    expect(() => assertPageTextUploadArgs("artifacts_create_upload", upload, DEFAULT_PAGE_TEXT_BUDGET)).toThrow();
    expect(() => assertPageTextUploadArgs("artifacts_create_upload", upload, tenMib)).not.toThrow();
    expect(() => assertPageTextUploadArgs("artifacts_create_upload",
      { mimeType: "text/html", maxSize: 10 * MIB + 1 }, tenMib)).toThrow();
    const bundle = { assets: [{ mimeType: "text/html", size: 6 * MIB }, { mimeType: "text/css", size: 3 * MIB }] };
    expect(() => assertPageTextUploadArgs("artifacts_publish_bundle", bundle, DEFAULT_PAGE_TEXT_BUDGET)).toThrow();
    expect(() => assertPageTextUploadArgs("artifacts_publish_bundle", bundle, tenMib)).not.toThrow();
    expect(() => assertPageTextUploadArgs("artifacts_publish_bundle",
      { assets: [...bundle.assets, { mimeType: "application/json", size: 2 * MIB }] }, tenMib)).toThrow();
    // Binaries are not page text: release ceilings apply elsewhere.
    expect(() => assertPageTextUploadArgs("artifacts_create_upload",
      { mimeType: "video/mp4", maxSize: 16 * MIB }, DEFAULT_PAGE_TEXT_BUDGET)).not.toThrow();
  });
});
