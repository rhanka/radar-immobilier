/**
 * 6L2 invalidation helpers: cursor binding, tick coalescing, watcher
 * interval resolution and SSE frame encoding. Pure unit tests, no database.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECTION_WATCH_INTERVAL_MS,
  decideInvalidationTick,
  decodeInvalidationCursor,
  encodeInvalidationCursor,
  invalidationSseFrame,
  isCompatibleCursor,
  resolveWatchIntervalMs,
  type InvalidationCursor,
} from "./projection-invalidation.js";

const cursor: InvalidationCursor = {
  version: 1,
  sub: "synthetic-viewer",
  workspaceId: "11111111-1111-1111-1111-111111111111",
  citySlug: "synthetic-city",
  mode: "signal",
  token: "a".repeat(64),
};

const live = {
  sub: "synthetic-viewer",
  workspaceId: "11111111-1111-1111-1111-111111111111",
  citySlug: "synthetic-city",
  mode: "signal",
};

describe("invalidation cursor", () => {
  it("should round-trip the viewer, scope, mode and token", () => {
    expect(decodeInvalidationCursor(encodeInvalidationCursor(cursor))).toEqual(cursor);
  });

  it("should resync on missing, malformed or oversized cursors", () => {
    expect(decodeInvalidationCursor(null)).toBeNull();
    expect(decodeInvalidationCursor(undefined)).toBeNull();
    expect(decodeInvalidationCursor("")).toBeNull();
    expect(decodeInvalidationCursor("not-base64!!!")).toBeNull();
    expect(decodeInvalidationCursor("x".repeat(4097))).toBeNull();
    expect(isCompatibleCursor(null, live)).toBe(false);
  });

  it("should reject cursors from another viewer, workspace, city or mode", () => {
    expect(isCompatibleCursor(cursor, live)).toBe(true);
    expect(isCompatibleCursor(cursor, { ...live, sub: "synthetic-other" })).toBe(false);
    expect(isCompatibleCursor(cursor, {
      ...live, workspaceId: "22222222-2222-2222-2222-222222222222",
    })).toBe(false);
    expect(isCompatibleCursor(cursor, { ...live, citySlug: "other-city" })).toBe(false);
    expect(isCompatibleCursor(cursor, { ...live, mode: "lot" })).toBe(false);
  });
});

describe("invalidation tick", () => {
  it("should stay steady when the token is unchanged and invalidate otherwise", () => {
    expect(decideInvalidationTick("token-a", "token-a")).toEqual({ kind: "steady" });
    expect(decideInvalidationTick("token-a", "token-b")).toEqual({ kind: "invalidated", token: "token-b" });
  });

  it("should invalidate on initial connection, restart and lost cursor", () => {
    expect(decideInvalidationTick(null, "token-a")).toEqual({ kind: "invalidated", token: "token-a" });
  });
});

describe("watcher interval", () => {
  it("should default to one second and accept in-range configuration", () => {
    expect(resolveWatchIntervalMs({})).toBe(DEFAULT_PROJECTION_WATCH_INTERVAL_MS);
    expect(resolveWatchIntervalMs({ PROJECTION_WATCH_INTERVAL_MS: "" }))
      .toBe(DEFAULT_PROJECTION_WATCH_INTERVAL_MS);
    expect(resolveWatchIntervalMs({ PROJECTION_WATCH_INTERVAL_MS: "250" })).toBe(250);
    expect(resolveWatchIntervalMs({}, 2000)).toBe(2000);
  });

  it("should fall back to the default outside the documented range", () => {
    expect(resolveWatchIntervalMs({ PROJECTION_WATCH_INTERVAL_MS: "nope" }))
      .toBe(DEFAULT_PROJECTION_WATCH_INTERVAL_MS);
    expect(resolveWatchIntervalMs({ PROJECTION_WATCH_INTERVAL_MS: "50" }))
      .toBe(DEFAULT_PROJECTION_WATCH_INTERVAL_MS);
    expect(resolveWatchIntervalMs({ PROJECTION_WATCH_INTERVAL_MS: "60000" }))
      .toBe(DEFAULT_PROJECTION_WATCH_INTERVAL_MS);
    expect(resolveWatchIntervalMs({}, 50)).toBe(DEFAULT_PROJECTION_WATCH_INTERVAL_MS);
  });
});

describe("invalidation SSE frame", () => {
  it("should encode a named event without business payloads", () => {
    expect(invalidationSseFrame("invalidated", { token: "token-a" }))
      .toBe('event: invalidated\ndata: {"token":"token-a"}\n\n');
  });
});
