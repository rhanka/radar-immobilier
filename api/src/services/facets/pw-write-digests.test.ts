// PW-D digest unit tests: canonical JSON, intent binding, no I/O.
import { describe, expect, it } from "vitest";
import { assertPwIntentBinding, newPwIntentIds, pwDigest, pwIntentDigest } from "./pw-write-digests.js";

const BINDING = {
  principal: { issuer: "https://auth.example.test", sub: "subject-1", tier: "preprod" },
  pageSessionId: "page-session-1",
  pageInstanceId: "page-instance-1",
  grantReference: "grant-jti-1",
  intentId: "11111111-1111-4111-8111-111111111111",
  invocationId: "22222222-2222-4222-8222-222222222222",
  operationDigest: "a".repeat(64),
  commandKey: "33333333-3333-4333-8333-333333333333",
  expectedProjectionToken: "b".repeat(64),
  expiresAtMs: 9_999_999_999_999,
  artifactRef: { artifactId: "artifact-1", releaseId: "release-1" },
  challengeKeyId: "key-1",
  authorityReferences: { tier: "preprod", policy: "policy", release: "release",
    delegation: "delegation", reader: "reader", grant: "grant-jti-1", page_session: "page-session-1" },
};

describe("pw write digests", () => {
  it("should sort object keys and keep array order", () => {
    expect(pwDigest({ b: 1, a: 2 })).toBe(pwDigest({ a: 2, b: 1 }));
    expect(pwDigest({ list: [2, 1] })).not.toBe(pwDigest({ list: [1, 2] }));
    expect(pwDigest({ nested: { z: 1, a: [3, 2] } })).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should bind the H5 context and reject forged bindings", () => {
    expect(() => assertPwIntentBinding(BINDING)).not.toThrow();
    const first = pwIntentDigest(BINDING, { operation: "select" });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(pwIntentDigest(BINDING, { operation: "select" })).toBe(first);
    expect(pwIntentDigest({ ...BINDING, pageInstanceId: "other" }, { operation: "select" }))
      .not.toBe(first);
    expect(() => assertPwIntentBinding({ ...BINDING, intentId: "nope" }))
      .toThrowError("invalid_facet_command");
    expect(() => assertPwIntentBinding({ ...BINDING, principal: { sub: "x" } }))
      .toThrowError("invalid_facet_command");
  });

  it("should mint unique intent identifiers", () => {
    const first = newPwIntentIds();
    const second = newPwIntentIds();
    expect(first.intentId).not.toBe(second.intentId);
    expect(first.invocationId).not.toBe(second.invocationId);
    expect(first.challengeId).not.toBe(second.challengeId);
  });
});
