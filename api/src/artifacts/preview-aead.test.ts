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
});
