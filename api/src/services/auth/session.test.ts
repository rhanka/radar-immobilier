import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  signSession,
  verifySession,
  shouldRefreshSession,
  type VerifiedSession,
} from "./session.js";

const SECRET = "test-session-secret-at-least-32-bytes-long!!";

describe("session cookie (HS256)", () => {
  it("exposes a stable cookie name", () => {
    expect(SESSION_COOKIE_NAME).toBe("radar_session");
  });

  it("round-trips claims through sign + verify", async () => {
    const token = await signSession(
      { sub: "user-1", name: "Alice", email: "alice@example.com" },
      { sessionSecret: SECRET, ttlSeconds: 3600, now: 1_000_000_000_000 },
    );
    const session = await verifySession(token, {
      sessionSecret: SECRET,
      now: 1_000_000_000_000,
    });
    expect(session).not.toBeNull();
    expect(session?.sub).toBe("user-1");
    expect(session?.name).toBe("Alice");
    expect(session?.email).toBe("alice@example.com");
    expect(session?.exp).toBe(1_000_000_000 + 3600);
  });

  it("omits absent optional claims", async () => {
    const token = await signSession(
      { sub: "user-2" },
      { sessionSecret: SECRET, ttlSeconds: 3600, now: 1_000_000_000_000 },
    );
    const session = await verifySession(token, {
      sessionSecret: SECRET,
      now: 1_000_000_000_000,
    });
    expect(session?.sub).toBe("user-2");
    expect(session?.name).toBeUndefined();
    expect(session?.email).toBeUndefined();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(
      { sub: "user-3" },
      { sessionSecret: SECRET, ttlSeconds: 3600, now: 1_000_000_000_000 },
    );
    const session = await verifySession(token, {
      sessionSecret: "a-totally-different-secret-also-32-bytes!!",
      now: 1_000_000_000_000,
    });
    expect(session).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSession(
      { sub: "user-4" },
      { sessionSecret: SECRET, ttlSeconds: 60, now: 1_000_000_000_000 },
    );
    // 120s later — past the 60s TTL.
    const session = await verifySession(token, {
      sessionSecret: SECRET,
      now: 1_000_000_000_000 + 120_000,
    });
    expect(session).toBeNull();
  });

  it("rejects a malformed token without throwing", async () => {
    const session = await verifySession("not-a-jwt", {
      sessionSecret: SECRET,
      now: 1_000_000_000_000,
    });
    expect(session).toBeNull();
  });
});

describe("sliding session — iat0 anchor + shouldRefreshSession", () => {
  const T0 = 1_000_000_000_000; // ms
  const TTL = 1_296_000; // 15 days (seconds)
  const ABS = 2_592_000; // 30 days (seconds)

  it("first mint anchors iat0 to the current iat", async () => {
    const token = await signSession(
      { sub: "u" },
      { sessionSecret: SECRET, ttlSeconds: TTL, now: T0 },
    );
    const s = await verifySession(token, { sessionSecret: SECRET, now: T0 });
    expect(s?.iat).toBe(T0 / 1000);
    expect(s?.iat0).toBe(T0 / 1000); // defaults to iat on first mint
  });

  it("a sliding re-mint PRESERVES the original iat0 while advancing iat/exp", async () => {
    // Re-mint 10 days later, carrying the original iat0 forward.
    const remintAt = T0 + 10 * 86_400 * 1000;
    const token = await signSession(
      { sub: "u", iat0: T0 / 1000 },
      { sessionSecret: SECRET, ttlSeconds: TTL, now: remintAt },
    );
    const s = await verifySession(token, {
      sessionSecret: SECRET,
      now: remintAt,
    });
    expect(s?.iat0).toBe(T0 / 1000); // original anchor kept
    expect(s?.iat).toBe(remintAt / 1000); // current issuance advanced
    expect(s?.exp).toBe(remintAt / 1000 + TTL); // exp pushed forward
  });

  function session(over: Partial<VerifiedSession>): VerifiedSession {
    return { sub: "u", exp: 0, iat: 0, ...over };
  }

  it("does NOT refresh before the half-life", () => {
    const nowSec = T0 / 1000;
    // exp far in the future (just minted): exp - now == TTL > TTL/2.
    const s = session({ exp: nowSec + TTL, iat: nowSec, iat0: nowSec });
    expect(
      shouldRefreshSession(s, { ttlSeconds: TTL, absoluteMaxSeconds: ABS, now: T0 }),
    ).toBe(false);
  });

  it("refreshes once past the half-life (within the absolute ceiling)", () => {
    const nowSec = T0 / 1000;
    // exp - now == TTL/4 < TTL/2, original issuance 10 days ago (< 30d ceiling).
    const s = session({
      exp: nowSec + TTL / 4,
      iat: nowSec - TTL / 4,
      iat0: nowSec - 10 * 86_400,
    });
    expect(
      shouldRefreshSession(s, { ttlSeconds: TTL, absoluteMaxSeconds: ABS, now: T0 }),
    ).toBe(true);
  });

  it("STOPS refreshing past the absolute ceiling (bounds a stolen cookie)", () => {
    const nowSec = T0 / 1000;
    // Past half-life BUT original issuance is 31 days ago (> 30d ceiling).
    const s = session({
      exp: nowSec + TTL / 4,
      iat: nowSec - TTL / 4,
      iat0: nowSec - 31 * 86_400,
    });
    expect(
      shouldRefreshSession(s, { ttlSeconds: TTL, absoluteMaxSeconds: ABS, now: T0 }),
    ).toBe(false);
  });

  it("falls back to iat when iat0 is absent (legacy token)", () => {
    const nowSec = T0 / 1000;
    // No iat0; iat 10 days ago, past half-life => should refresh.
    const s = session({ exp: nowSec + TTL / 4, iat: nowSec - 10 * 86_400 });
    expect(
      shouldRefreshSession(s, { ttlSeconds: TTL, absoluteMaxSeconds: ABS, now: T0 }),
    ).toBe(true);
  });
});
