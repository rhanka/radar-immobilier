import { describe, expect, it } from "vitest";
import {
  mintInitCookie,
  mintSessionCookie,
  parseCookieHeader,
  PREVIEW_INIT_COOKIE,
  PREVIEW_SESSION_COOKIE,
  readSessionClaims,
} from "./preview-session.js";

describe("preview page cookies", () => {
  it("should mint separate __Host- cookies with host-only attributes", () => {
    const init = mintInitCookie("ticket-1");
    expect(init.startsWith(`${PREVIEW_INIT_COOKIE}=ticket-1`)).toBe(true);
    for (const cookie of [init, mintSessionCookie(
      { sid: "s1", readerSub: "reader-alice", artifactId: "123e4567-e89b-12d3-a456-426614174000", createdAt: 1_000, expiresAt: 901_000 },
      "session-secret-32-bytes-long-pad!!",
    )]) {
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).not.toContain("Domain=");
    }
  });

  it("should never use radar_session as the page session", () => {
    const header = `${PREVIEW_SESSION_COOKIE}=sealed; radar_session=official`;
    expect(parseCookieHeader(header, PREVIEW_SESSION_COOKIE)).toBe("sealed");
  });

  it("should refuse expired or forged page sessions", () => {
    const secret = "session-secret-32-bytes-long-pad!!";
    const header = mintSessionCookie(
      { sid: "s1", readerSub: "reader-alice", artifactId: "123e4567-e89b-12d3-a456-426614174000", createdAt: 1_000, expiresAt: 2_000 },
      secret,
    ).split(";")[0] as string;
    expect(readSessionClaims(header, secret, 3_000)).toBeNull();
    expect(readSessionClaims(`${PREVIEW_SESSION_COOKIE}=forged`, secret, 1_000)).toBeNull();
    expect(readSessionClaims(header, "wrong-secret-32-bytes-long-pad!!!", 1_000)).toBeNull();
  });
});
