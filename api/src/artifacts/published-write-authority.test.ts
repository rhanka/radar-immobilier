import { expect, it } from "vitest";
import { manifestRequestsWrites, PUBLISHED_WRITE_DECLARATION, PUBLISHED_WRITE_DIGEST,
  lockPublishedWriteAuthority, PUBLISHED_WRITE_POLICY } from "./published-write-authority.js";
import type { WriteTx } from "../services/facets/signal-write-scope.js";
import { samePwIdentityDomain } from "./write-intent-principal.js";

it("should require one exact immutable write declaration", () => {
  const file = { path: "radar-write.json", digest: PUBLISHED_WRITE_DIGEST, size: Buffer.byteLength(PUBLISHED_WRITE_DECLARATION) };
  expect(manifestRequestsWrites(JSON.stringify({ files: [file] }))).toBe(true);
  for (const files of [[], [file, file], [{ ...file, digest: `sha256:${"0".repeat(64)}` }], [{ ...file, size: file.size + 1 }]]) {
    expect(manifestRequestsWrites(JSON.stringify({ files }))).toBe(false);
  }
  expect(manifestRequestsWrites("null")).toBe(false);
});

it("should retain identity provenance through JSONB key reordering", () => {
  const left = { identityIssuer: "https://idp.test", tier: "preprod" as const,
    appOrigin: "https://app.test", clientId: "radar" };
  expect(samePwIdentityDomain(left, { clientId: left.clientId, appOrigin: left.appOrigin,
    tier: left.tier, identityIssuer: left.identityIssuer })).toBe(true);
  for (const field of ["identityIssuer", "tier", "appOrigin", "clientId"] as const) {
    expect(samePwIdentityDomain(left, { ...left, [field]: "different" })).toBe(false);
  }
});

it("should close runtime intents whose durable L3 binding was omitted", async () => {
  await expect(lockPublishedWriteAuthority({} as WriteTx, { policy: PUBLISHED_WRITE_POLICY }))
    .rejects.toThrow("write_authority_unavailable");
  await expect(lockPublishedWriteAuthority({} as WriteTx, { policy: "synthetic" })).resolves.toBeUndefined();
});
