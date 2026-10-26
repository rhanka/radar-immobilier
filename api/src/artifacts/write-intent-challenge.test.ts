// PW-A PWA-06: single-use challenge token stays application-only.
import { describe, expect, it } from "vitest";
import { issueWriteChallengeToken, verifyWriteChallengeToken } from "./write-intent-challenge.js";

describe("write challenge", () => {
  it("should issue a bounded token and verify its binding", () => {
    const secret = new TextEncoder().encode("challenge-secret-32-bytes-padding!!");
    const material = { challengeId: "d".repeat(64), intentDigest: "e".repeat(64),
      expiresAtMs: 1_000_000, keyId: "key-1" };
    const token = issueWriteChallengeToken(material, secret);
    expect(token.length).toBeLessThanOrEqual(512);
    expect(verifyWriteChallengeToken(token, material, secret)).toBe(true);
    expect(verifyWriteChallengeToken(token, { ...material, keyId: "key-2" }, secret)).toBe(false);
    expect(verifyWriteChallengeToken(`${token}x`, material, secret)).toBe(false);
  });
});
