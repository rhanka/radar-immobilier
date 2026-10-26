// PW-A PWA-05: preparation refuses out-of-scope orders without storage.
import { describe, expect, it } from "vitest";
import { prepareWriteIntent } from "./write-intent-service.js";

const GRANT = {
  issuer: "https://h5.example.test", audience: "radar-artifact-write", tier: "preprod",
  jti: "grant-1", sessionId: "page-1", sub: "reader-alice", readerSub: "reader-alice",
  identityIssuer: "https://auth.example.test", artifactId: "artifact-1", releaseId: "release-1",
  host: "artifact.pages.example.test", profileName: "h5-signal-write-v2",
  profileFingerprint: "c".repeat(64), policyRevision: "policy-1",
  workspaceId: "44444444-4444-4444-8444-444444444444", citySlug: "demo-town",
  operations: ["facets.signals.personal.select.v1"], expiresAtMs: 9_999_999_999_999,
};

const BODY = {
  operation: "facets.signals.personal.select.v1",
  workspaceId: "44444444-4444-4444-8444-444444444444",
  target: { citySlug: "demo-town", type: "Signal", id: "synthetic-signal-01" },
  expectedHeadId: null,
  displayedFingerprint: "a".repeat(64),
  expectedProjectionToken: "b".repeat(64),
  basket: "pertinent",
};

const DEPS = {
  challengeKeyId: "key-1",
  confirmationBaseUrl: "https://immo.example.test/artifact-write/intents",
  managementBaseUrl: "https://immo.example.test/artifact-write/intents",
  statusBaseUrl: "https://immo.example.test/api/v1/artifacts/write-intents",
};

const UNTOUCHED_DB = { transaction: () => {
  throw new Error("storage must stay untouched on refusal");
} };

describe("write preparation guard", () => {
  it("should refuse another workspace without touching storage", async () => {
    await expect(prepareWriteIntent(UNTOUCHED_DB as never, GRANT as never,
      { ...BODY, workspaceId: "55555555-5555-4555-8555-555555555555" },
      "66666666-6666-4666-8666-666666666666", "instance-1", DEPS as never))
      .rejects.toThrow("delegated_scope_refused");
  });

  it("should refuse an expired grant before storage with its exact typed error", async () => {
    await expect(prepareWriteIntent(UNTOUCHED_DB as never,
      { ...GRANT, expiresAtMs: 1000 } as never, BODY,
      "66666666-6666-4666-8666-666666666666", "instance-1",
      { ...DEPS, nowMs: () => 1000 })).rejects.toMatchObject({ status: 401, message: "write_grant_expired" });
  });
});
