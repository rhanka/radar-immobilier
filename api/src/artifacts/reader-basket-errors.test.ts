import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createReaderContentApp } from "./content-serve.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { mintGrant } from "./preview-grant.js";
import { scopedClassificationRoute } from "../routes/scoped-classification.js";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { credentials, GRANT_SECRET, SESSION_SECRET, ISSUER, HOST } from "./reader-test-fixture.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const reads = [
  { op: "baskets.context.v1", path: "facet-context", valid: "", invalid: "unknown=1" },
  { op: "baskets.search.v1", path: "signal-facets/search", valid: "citySlug=valleyfield", invalid: "citySlug=valleyfield&limit=0" },
  { op: "baskets.state.v1", path: "signal-facets/state", valid: "citySlug=valleyfield&type=Signal&id=s",
    invalid: "citySlug=valleyfield&type=Signal&id=s&reveal=maybe" },
];

describe("basket transport error parity", () => {
  it.each(reads)("should preserve query and internal failures for $op", async ({ op, path, valid, invalid }) => {
    const official = new Hono();
    official.use("*", async (c, next) => { c.set("session" as never, { sub: "reader-alice" } as never); await next(); });
    official.route("/", scopedClassificationRoute({ db: {} as Database, store: {} as ObjectStore, auth: { enabled: true } }));
    const reader = createReaderContentApp({ contentBase: "pages.example.test", grantSecret: GRANT_SECRET,
      sessionSecret: SESSION_SECRET, issuer: ISSUER, authority: createFixtureAuthority(), now: () => 1_000,
      readOperation: async () => { throw new Error("synthetic backend failure"); } });
    const grant = await mintGrant({ ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000",
      releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "parity",
      profileName: "demo", policyRevision: "pol-001", profileFingerprint: fingerprintReaderProfile({
        name: "demo", policyRevision: "pol-001", capabilities: ["geo.read", "signals.protected-read"] }) }, GRANT_SECRET, 1_000);
    for (const [query, code] of [[invalid, "invalid_query"], [valid, "internal_error"]]) {
      const expected = await official.request(`https://app.example.test/api/v1/workspaces/${workspaceId}/${path}?${query}`);
      const actual = await reader.request(`https://${HOST}/__reader/api/${op}?workspaceId=${workspaceId}&${query}`, {
        headers: { host: HOST, cookie: await credentials("reader-alice", "parity", 1_000), "x-preview-grant": grant } });
      const expectedBody = await expected.json(), actualBody = await actual.json();
      expect(actual.status).toBe(expected.status);
      expect(actualBody.error.code).toBe(code);
      expect(actualBody.requestId).toMatch(/^[a-f0-9-]{36}$/);
      expect(expectedBody.requestId).toMatch(/^[a-f0-9-]{36}$/);
      expect({ ...actualBody, requestId: "id" }).toEqual({ ...expectedBody, requestId: "id" });
    }
  });
});
