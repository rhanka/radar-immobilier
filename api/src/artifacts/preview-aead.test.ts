import { describe, expect, it } from "vitest";
import { openSession, sealSession } from "./preview-aead.js";

describe("preview AEAD envelope", () => {
  it("should round-trip a sealed payload", () => {
    const sealed = sealSession('{"sid":"s1"}', "test-secret-32-bytes-padding!!!");
    expect(openSession(sealed, "test-secret-32-bytes-padding!!!")).toBe('{"sid":"s1"}');
  });

  it("should fail closed on forgery, truncation and wrong key", () => {
    const sealed = sealSession('{"sid":"s1"}', "test-secret-32-bytes-padding!!!");
    expect(openSession(`${sealed}x`, "test-secret-32-bytes-padding!!!")).toBeNull();
    expect(openSession("a.b", "test-secret-32-bytes-padding!!!")).toBeNull();
    expect(openSession(sealed, "wrong-secret-32-bytes-padding!!!!")).toBeNull();
  });
  it("should refuse shortened GCM authentication tags", () => {
    const secret = "test-secret-32-bytes-padding!!!";
    const [nonce, body, tag] = sealSession("payload", secret).split(".") as [string, string, string];
    for (const length of [4, 8, 12, 13, 14, 15]) {
      const prefix = Buffer.from(tag, "base64url").subarray(0, length).toString("base64url");
      expect(openSession(`${nonce}.${body}.${prefix}`, secret), `tag length ${length}`).toBeNull();
    }
  });
});
