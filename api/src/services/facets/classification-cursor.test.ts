import { describe, expect, it } from "vitest";
import { CursorPayload, cursorContext, parseClassificationCursor, requireCursorKeyring, signClassificationCursor } from "./classification-cursor.js";
import { continueSignalSearch } from "./classification-continuation.js";

export const testKeyring = { currentKeyId: "test-key", keys: new Map([["test-key", Buffer.alloc(32, 11)]]) };
describe("classification signed continuations", () => {
  const ring = testKeyring;
  const binding = { sub: "private-reader", workspaceId: "workspace", citySlug: "city", queryDigest: "b".repeat(64), snapshotToken: "c".repeat(64) };
  const rows = [1, 2, 3, 4, 5];
  const first = () => continueSignalSearch(rows, ring, binding, 2, undefined, 1000);
  it("should preserve the initial expiry and opaque context through all pages", () => {
    const cursor = first().page.nextCursor!;
    const second = continueSignalSearch(rows, ring, binding, 2, cursor, 1100);
    expect(second.items).toEqual([3, 4]);
    expect(parseClassificationCursor(ring, second.page.nextCursor!).expiresAt).toBe(1300);
    expect(continueSignalSearch(rows, ring, binding, 2, second.page.nextCursor!, 1299).items).toEqual([5]);
    expect(parseClassificationCursor(ring, cursor).contextDigest).toBe(cursorContext(ring, binding.sub, binding.workspaceId, binding.citySlug));
    expect(Buffer.from(cursor.split(".")[0]!, "base64url").toString()).not.toContain(binding.sub);
  });
  it("should refuse altered signatures, missing keyrings and excess fields", () => {
    const cursor = first().page.nextCursor!;
    expect(() => parseClassificationCursor(ring, `${cursor.slice(0, -2)}AA`)).toThrow("invalid_cursor");
    expect(() => requireCursorKeyring()).toThrow("transport_unavailable");
    expect(CursorPayload.safeParse({ ...parseClassificationCursor(ring, cursor), rawId: "secret" }).success).toBe(false);
  });
  it("should bind purpose, reader, scope, query, limit, expiry and snapshot in order", () => {
    const cursor = first().page.nextCursor!;
    for (const change of [{ sub: "other" }, { workspaceId: "other" }, { citySlug: "other" }, { queryDigest: "d".repeat(64) }]) {
      expect(() => continueSignalSearch(rows, ring, { ...binding, ...change }, 2, cursor, 1001)).toThrow("incompatible_continuation");
    }
    expect(() => continueSignalSearch(rows, ring, binding, 1, cursor, 1001)).toThrow("incompatible_continuation");
    expect(() => continueSignalSearch(rows, ring, binding, 2, cursor, 1300)).toThrow("cursor_expired");
    expect(() => continueSignalSearch(rows, ring, { ...binding, snapshotToken: "e".repeat(64) }, 2, cursor, 1001)).toThrow("snapshot_changed");
    const altered = (extra: object) => signClassificationCursor(ring, { ...parseClassificationCursor(ring, cursor), ...extra });
    expect(() => continueSignalSearch(rows, ring, binding, 2, altered({ purpose: "signal-history" }), 1001)).toThrow("incompatible_continuation");
    expect(() => continueSignalSearch(rows, ring, binding, 2, altered({ position: 9 }), 1001)).toThrow("invalid_cursor");
  });
  it("should remain below one KiB with maximal counters and key IDs without native IDs", () => {
    const id = "x".repeat(64);
    const maximumRing = { currentKeyId: id, keys: new Map([[id, Buffer.alloc(32, 12)]]) };
    const payload = { ...parseClassificationCursor(ring, first().page.nextCursor!), keyId: id,
      issuedAt: Number.MAX_SAFE_INTEGER - 300, expiresAt: Number.MAX_SAFE_INTEGER, position: Number.MAX_SAFE_INTEGER, limit: 100 };
    expect(Buffer.byteLength(signClassificationCursor(maximumRing, payload))).toBeLessThan(1024);
  });
});
