import { describe, expect, it, vi } from "vitest";
import { makeApp, fixtureReaderDeps, GRANT_SECRET, HOST, ISSUER, SESSION_SECRET, credentials } from "./reader-test-fixture.js";
import { createReaderContentApp } from "./content-serve.js";
import { mintGrant } from "./preview-grant.js";
import { fingerprintReaderProfile, createFixtureAuthority } from "./reader-profile.js";
import { injectGrantIntoHtml, releaseCspForHtml } from "./release-files.js";

async function token() {
  return mintGrant({ ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000",
    releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "s1",
    profileName: "demo", policyRevision: "pol-001", profileFingerprint: fingerprintReaderProfile({
      name: "demo", policyRevision: "pol-001", capabilities: ["geo.read", "signals.protected-read"] }) }, GRANT_SECRET, 1000);
}
describe("published release isolation", () => {
  it("should rewrite quoted resources and place the grant before fragments", () => {
    expect(injectGrantIntoHtml("<script SRC = '/main.js#part'></script>", "scoped"))
      .toBe("<script SRC='/main.js?grant=scoped#part'></script>");
    expect(injectGrantIntoHtml('<link href="/s.css?v=1">', "scoped"))
      .toContain('/s.css?v=1&amp;grant=scoped');
    for (const url of ["javascript:alert(1)", "blob:https://other.test/x", "HTTPS://other.test/x", "//other.test/x"]) {
      expect(injectGrantIntoHtml(`<a href="${url}">x</a>`, "scoped")).not.toContain("grant=");
    }
  });
  it("should hash only release inline code and preserve external isolation", () => {
    const csp = releaseCspForHtml("<script>document.body.textContent='ok'</script><style>body{color:red}</style>");
    expect(csp.match(/sha256-/g)).toHaveLength(3);
    for (const directive of ["base-uri 'none'", "form-action 'none'", "worker-src 'none'", "frame-src 'none'"]) expect(csp).toContain(directive);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });
  it("should revalidate authorization after a delayed release read", async () => {
    let version = "v1";
    const app = createReaderContentApp({ ...fixtureReaderDeps(), contentBase: "pages.example.test",
      grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, issuer: ISSUER, now: () => 1000,
      authority: { ...createFixtureAuthority(), getAuthorizationVersion: async () => version },
      releaseFiles: { getFile: async () => { version = "revoked"; return { body: "private", contentType: "text/html" }; } } });
    const response = await app.request(`https://${HOST}/?grant=${await token()}`, {
      headers: { host: HOST, cookie: await credentials("reader-alice", "s1", 1000) } });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("private");
  });
  it("should reject leaked credential markers in byte responses", async () => {
    const app = createReaderContentApp({ ...fixtureReaderDeps(), contentBase: "pages.example.test",
      grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, issuer: ISSUER, now: () => 1000,
      releaseFiles: { getFile: vi.fn(async () => ({ body: Buffer.from("publisher-secret"), contentType: "text/javascript" })) } });
    const response = await app.request(`https://${HOST}/main.js?grant=${await token()}`, {
      headers: { host: HOST, cookie: await credentials("reader-alice", "s1", 1000) } });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("publisher-secret");
  });
  it("should reject duplicate operation parameters", async () => {
    const response = await makeApp().request(`https://${HOST}/__reader/api/baskets.context.v1?workspaceId=x&workspaceId=y&grant=${await token()}`, {
      headers: { host: HOST, cookie: await credentials("reader-alice", "s1", 1000) } });
    expect(response.status).toBe(400);
  });
});
