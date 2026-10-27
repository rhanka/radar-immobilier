import { describe, expect, it } from "vitest";
import {
  cursorKeyringFromParts,
  resolveReaderCursorKeyring,
} from "./reader-cursor-keyring.js";
import {
  parseClassificationCursor,
  requireCursorKeyring,
  signClassificationCursor,
} from "../services/facets/classification-cursor.js";

const SECRET = Buffer.alloc(32, 7).toString("base64");
const KEY_ID = "test-key-1";

function payload() {
  return {
    v: 1 as const, purpose: "signal-search" as const,
    contextDigest: "a".repeat(64), queryDigest: "b".repeat(64), snapshotToken: "c".repeat(64),
    position: 20, limit: 20, issuedAt: 1000, expiresAt: 1300, keyId: KEY_ID,
  };
}

describe("cursor keyring loading", () => {
  it("should load a persistent keyring from the environment", () => {
    const ring = resolveReaderCursorKeyring({
      CLASSIFICATION_CURSOR_SECRET: SECRET, CLASSIFICATION_CURSOR_KEY_ID: KEY_ID,
    });
    expect(requireCursorKeyring(ring).currentKeyId).toBe(KEY_ID);
  });

  it("should stay closed when the secret or key id is missing", () => {
    expect(resolveReaderCursorKeyring({})).toBeUndefined();
    expect(cursorKeyringFromParts("", KEY_ID)).toBeUndefined();
    expect(cursorKeyringFromParts(SECRET, "bad id!")).toBeUndefined();
    expect(cursorKeyringFromParts(`${SECRET}!`, KEY_ID)).toBeUndefined();
    expect(cursorKeyringFromParts("!".repeat(80), KEY_ID)).toBeUndefined();
    expect(() => requireCursorKeyring(undefined)).toThrow("transport_unavailable");
  });

  it("should continue a first page cursor after a restart with the same secret", () => {
    const first = resolveReaderCursorKeyring({
      CLASSIFICATION_CURSOR_SECRET: SECRET, CLASSIFICATION_CURSOR_KEY_ID: KEY_ID,
    })!;
    const cursor = signClassificationCursor(first, payload());
    const restarted = resolveReaderCursorKeyring({
      CLASSIFICATION_CURSOR_SECRET: SECRET, CLASSIFICATION_CURSOR_KEY_ID: KEY_ID,
    })!;
    expect(parseClassificationCursor(restarted, cursor).position).toBe(20);
  });

  it("should refuse a cursor signed by another secret", () => {
    const ring = cursorKeyringFromParts(SECRET, KEY_ID)!;
    const cursor = signClassificationCursor(ring, payload());
    const other = cursorKeyringFromParts(Buffer.alloc(32, 9).toString("base64"), KEY_ID)!;
    expect(() => parseClassificationCursor(other, cursor)).toThrow();
  });
});
