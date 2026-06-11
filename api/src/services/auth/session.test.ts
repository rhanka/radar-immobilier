import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  signSession,
  verifySession,
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
