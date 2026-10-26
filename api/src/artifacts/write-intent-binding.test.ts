// PW-A PWA-04: binding canonicalisation and duplicate key refusal.
import { describe, expect, it } from "vitest";
import { buildWriteIntentBinding, hasDuplicateJsonKeys } from "./write-intent-binding.js";

const GRANT = {
  issuer: "https://h5.example.test", audience: "radar-artifact-write", tier: "preprod",
  jti: "33333333-3333-4333-8333-333333333333", sessionId: "page-session-1",
  sub: "reader-alice", readerSub: "reader-alice", identityIssuer: "https://auth.example.test",
  artifactId: "artifact-1", releaseId: "release-1", host: "artifact.pages.example.test",
  profileName: "h5-signal-write-v2", profileFingerprint: "c".repeat(64),
  policyRevision: "policy-1", workspaceId: "44444444-4444-4444-8444-444444444444",
  citySlug: "demo-town", operations: ["facets.signals.personal.select.v1"],
  expiresAtMs: 9_999_999_999_999,
};

const BODY = {
  operation: "facets.signals.personal.select.v1" as const,
  workspaceId: "44444444-4444-4444-8444-444444444444",
  target: { citySlug: "demo-town", type: "Signal" as const, id: "synthetic-signal-01" },
  expectedHeadId: null,
  displayedFingerprint: "a".repeat(64),
  expectedProjectionToken: "b".repeat(64),
  basket: "pertinent" as const,
};

describe("write binding and challenge", () => {
  it("should bind grant, body, key, and expiry without page digests", () => {
    const binding = buildWriteIntentBinding({ grant: GRANT, body: BODY,
      commandKey: "55555555-5555-4555-8555-555555555555",
      intentId: "66666666-6666-4666-8666-666666666666",
      invocationId: "77777777-7777-4777-8777-777777777777",
      pageInstanceId: "instance-1", expiresAtMs: 1_000_000, challengeKeyId: "key-1",
      authorityReferences: { tier: "preprod", policy: "policy-1", release: "release-1",
        delegation: "delegation-1", reader: "reader-alice", grant: GRANT.jti, page_session: GRANT.sessionId } });
    expect(binding.principal).toEqual({ issuer: "https://auth.example.test", sub: "reader-alice", tier: "preprod" });
    expect(binding.operationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(hasDuplicateJsonKeys('{"a":1,"a":2}')).toBe(true);
    expect(hasDuplicateJsonKeys('{"a":1,"b":2}')).toBe(false);
  });

  it("should decode escaped keys and distinguish values from keys", () => {
    expect(hasDuplicateJsonKeys('{"a":1,"\\u0061":2}')).toBe(true);
    expect(hasDuplicateJsonKeys('{"outer":{"a":1,"a":2}}')).toBe(true);
    expect(hasDuplicateJsonKeys('{"x":"a","a":2}')).toBe(false);
    expect(hasDuplicateJsonKeys('{"x":"a","y":"a"}')).toBe(false);
    expect(hasDuplicateJsonKeys('{"left":{"a":1},"right":{"a":2}}')).toBe(false);
  });

});
