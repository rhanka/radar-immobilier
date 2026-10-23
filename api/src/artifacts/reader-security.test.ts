import { describe, expect, it } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { mintGrant } from "./preview-grant.js";
import { mintSessionCookie } from "./preview-session.js";
import { createFixtureAuthority } from "./reader-profile.js";
import { validatePreviewInit } from "./preview-init.js";
import { fixtureReaderDeps } from "./reader-test-fixture.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const HOST = `${ARTIFACT}.pages.example.test`;
const SECRET = "test-grant-secret-32-bytes-padding";
const SESSION = "test-session-secret-32-bytes-padding";
const ISSUER = { issuer: "https://api.example.test", audience: "reader", tier: "test" };

async function request(path: string, artifactId = ARTIFACT, extra: Record<string, string> = {}) {
  const grant = await mintGrant({ ...ISSUER, host: HOST, artifactId: ARTIFACT,
    releaseId: RELEASE, readerSub: "reader-alice", sessionId: "session-1",
    profileName: "demo", policyRevision: "pol-001" }, SECRET, 1_000);
  const cookie = mintSessionCookie({ sid: "session-1", readerSub: "reader-alice",
    artifactId, createdAt: 1_000, expiresAt: 90_000 }, SESSION).split(";")[0]!;
  const app = createReaderContentApp({ ...fixtureReaderDeps(), contentBase: "pages.example.test",
    grantSecret: SECRET, sessionSecret: SESSION, issuer: ISSUER, now: () => 2_000 });
  return app.request(`https://${HOST}${path}`, {
    headers: { host: HOST, cookie, "x-preview-grant": grant, ...extra },
  });
}

describe("reader security boundaries", () => {
  it("should reject a session for another artifact", async () => {
    expect((await request("/index.html", "another-artifact")).status).toBe(401);
  });
  it("should refuse ordinary API paths in the standalone reader", async () => {
    expect((await request("/api/v1/auth/me")).status).toBe(401);
  });
  it("should refuse service-worker requests at fallback paths", async () => {
    expect((await request("/fallback.js", ARTIFACT, { "service-worker": "script" })).status).toBe(404);
  });
  it("should reject an unrelated HTTPS origin during initialization", async () => {
    expect(await validatePreviewInit({ origin: "https://evil.example",
      artifactId: ARTIFACT, releaseId: RELEASE, profileName: "demo", returnTarget: "/" },
    createFixtureAuthority())).toBeNull();
  });
  it("should refuse content-supplied URLs and authority headers", async () => {
    expect((await request("/__reader/api/geo.read.v1?url=https://evil.example")).status).toBe(400);
    expect((await request("/__reader/api/geo.read.v1", ARTIFACT, { authorization: "Bearer publisher" })).status).toBe(400);
  });
});
