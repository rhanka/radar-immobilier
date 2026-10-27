import { describe, expect, it } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { mintSessionCookie } from "./preview-session.js";
import { mintGrant, verifyGrant } from "./preview-grant.js";
import { GRANT_SECRET, SESSION_SECRET, ISSUER, HOST } from "./reader-test-fixture.js";

const artifactId = "123e4567-e89b-12d3-a456-426614174000";
const releaseId = "123e4567-e89b-12d3-a456-426614174001";
const host = `${releaseId}.pinned.pages.example.test`;
const resource = { ...ISSUER, artifactId, releaseId, host, readerSub: "reader-alice", sessionId: "native",
  profileName: "demo", policyRevision: "pol-001", profileFingerprint: fingerprintReaderProfile({
    name: "demo", policyRevision: "pol-001", capabilities: ["geo.read", "signals.protected-read"] }) };

describe("native pinned release resources", () => {
  it.each(["", "&grant=&grant="])("should retain all navigation parameters when issuing only the grant (%s)", async (extra) => {
    const app = createReaderContentApp({ contentBase: "pages.example.test", issuer: ISSUER,
      grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, now: () => 60_000,
      authority: createFixtureAuthority(), releaseFiles: createMemoryReleaseFiles([
        { artifactId, releaseId, path: "/index.html", body: "<!doctype html><body>page</body>" }]) });
    const cookie = mintSessionCookie({ sid: resource.sessionId, readerSub: resource.readerSub,
      artifactId, createdAt: 1_000, expiresAt: 901_000, resource }, SESSION_SECRET).split(";")[0]!;
    const source = new URL(`https://${host}/index.html?workspaceId=w&citySlug=valleyfield&tag=a&tag=b&note=a%3Eb+two${extra}`);
    const response = await app.request(source.href, { headers: { host, cookie } });
    expect(response.status).toBe(303);
    const target = new URL(response.headers.get("location")!, source);
    expect(target.origin + target.pathname).toBe(source.origin + source.pathname);
    expect([...target.searchParams].filter(([key]) => key !== "grant"))
      .toEqual([...source.searchParams].filter(([key]) => key !== "grant"));
    expect(target.searchParams.getAll("grant")).toHaveLength(1);
    expect(await verifyGrant(target.searchParams.get("grant")!, { ...ISSUER, host }, GRANT_SECRET, 60_000)).not.toBeNull();
    expect((await app.request(target.href, { headers: { host, cookie } })).status).toBe(200);
  });
  it("should authorize only sealed session files on the exact pinned release host", async () => {
    const authority = createFixtureAuthority();
    let revoked = false;
    const app = createReaderContentApp({ contentBase: "pages.example.test", issuer: ISSUER,
      grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, now: () => 60_000,
      authority: { ...authority, getRights: async (sub, id) => revoked ? null : authority.getRights(sub, id) },
      releaseFiles: createMemoryReleaseFiles(["/main.js", "/nested.js", "/style.css", "/theme.css", "/dynamic.js"].map((path) =>
        ({ artifactId, releaseId, path, body: "release bytes" }))) });
    const cookie = mintSessionCookie({ sid: resource.sessionId, readerSub: resource.readerSub,
      artifactId, createdAt: 1_000, expiresAt: 901_000, resource }, SESSION_SECRET).split(";")[0]!;
    const request = (path: string, target = host, credential = cookie) => app.request(`https://${target}${path}`,
      { headers: { host: target, cookie: credential } });
    for (const path of ["/main.js", "/nested.js", "/style.css", "/theme.css", "/dynamic.js?v=1"]) {
      expect((await request(path)).status).toBe(200);
    }
    expect((await request("/missing.js")).status).toBe(404);
    expect((await request("/main.js", host, "")).status).toBe(401);
    expect((await request("/main.js", HOST)).status).toBe(401);
    expect((await request("/main.js", `${artifactId}.pinned.pages.example.test`)).status).toBe(401);
    expect((await request("/main.js?grant=forged")).status).toBe(401);
    expect((await request(`/main.js?grant=${await mintGrant(resource, GRANT_SECRET, 1_000)}`)).status).toBe(401);
    expect((await request("/__reader/api/geo.read.v1")).status).toBe(401);
    revoked = true;
    expect((await request("/nested.js")).status).toBe(401);
  });

  it("should refuse a sealed session whose resource reader or release was substituted", async () => {
    const app = createReaderContentApp({ contentBase: "pages.example.test", issuer: ISSUER,
      grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, now: () => 1_000,
      authority: createFixtureAuthority(), releaseFiles: createMemoryReleaseFiles([
        { artifactId, releaseId, path: "/main.js", body: "private" }]) });
    for (const changed of [{ ...resource, readerSub: "reader-bob" }, { ...resource, releaseId: artifactId }]) {
      const cookie = mintSessionCookie({ sid: resource.sessionId, readerSub: resource.readerSub,
        artifactId, createdAt: 1_000, expiresAt: 901_000, resource: changed }, SESSION_SECRET).split(";")[0]!;
      expect((await app.request(`https://${host}/main.js`, { headers: { host, cookie } })).status).toBe(401);
    }
  });
});
