import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { makeApp, fixtureReaderDeps, GRANT_SECRET, HOST, ISSUER, SESSION_SECRET, credentials } from "./reader-test-fixture.js";
import { createReaderContentApp } from "./content-serve.js";
import { mintGrant } from "./preview-grant.js";
import { fingerprintReaderProfile, createFixtureAuthority } from "./reader-profile.js";
import { releaseCspForHtml } from "./release-files.js";

async function token() {
  return mintGrant({ ...ISSUER, host: HOST, artifactId: "123e4567-e89b-12d3-a456-426614174000",
    releaseId: "123e4567-e89b-12d3-a456-426614174001", readerSub: "reader-alice", sessionId: "s1",
    profileName: "demo", policyRevision: "pol-001", profileFingerprint: fingerprintReaderProfile({
      name: "demo", policyRevision: "pol-001", capabilities: ["geo.read", "signals.protected-read"] }) }, GRANT_SECRET, 1000);
}
describe("published release isolation", () => {
  it.each(["script", "style"])("should hash interpreted %s text after quoted HTML attributes", (tag) => {
    const text = tag === "script" ? 'window.note="a &gt; b";\nwindow.ready=true;' : 'body::after{content:"a > b"}\n';
    const html = `<${tag} data-label="a>b" data-note='two words > three'>${text.replace(/\n/g, "\r\n")}</${tag}>`;
    expect(releaseCspForHtml(html)).toContain(`'sha256-${createHash("sha256").update(text).digest("base64")}'`);
  });
  it("should ignore apparent inline blocks inside HTML attributes, comments and textareas", () => {
    const html = '<div title="<script>attribute</script>"></div><!-- <script>comment</script> -->' +
      '<textarea><script>textarea</script></textarea><script>window.ready=true;</script>';
    const csp = releaseCspForHtml(html);
    expect(csp.match(/sha256-/g)).toHaveLength(2);
    expect(csp).toContain(`'sha256-${createHash("sha256").update("window.ready=true;").digest("base64")}'`);
  });
  it("should hash LF, CRLF and CR inline scripts as the browser interprets them", () => {
    const script = '\nconst s=document.createElement("script");\ns.src="/dep.js?v=1";\n';
    const expected = createHash("sha256").update(script).digest("base64");
    for (const eol of ["\n", "\r\n", "\r"]) {
      expect(releaseCspForHtml(`<script>${script.replace(/\n/g, eol)}</script>`)).toContain(`'sha256-${expected}'`);
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
  it("should preserve inline source without injecting HTML entities or grants", async () => {
    const app = createReaderContentApp({ ...fixtureReaderDeps(), contentBase: "pages.example.test",
      grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, issuer: ISSUER, now: () => 1000,
      releaseFiles: { getFile: async () => ({ body: `<script>const template='<img src="/logo.png">';</script>`, contentType: "text/html" }) } });
    const response = await app.request(`https://${HOST}/?grant=${await token()}`, {
      headers: { host: HOST, cookie: await credentials("reader-alice", "s1", 1000) } });
    expect(response.status).toBe(200);
    const html = await response.text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    expect(script).toBe(`const template='<img src="/logo.png">';`);
    expect(response.headers.get("content-security-policy"))
      .toContain(`'sha256-${createHash("sha256").update(script).digest("base64")}'`);
  });
  it("should reject duplicate operation parameters", async () => {
    const response = await makeApp().request(`https://${HOST}/__reader/api/baskets.context.v1?workspaceId=x&workspaceId=y&grant=${await token()}`, {
      headers: { host: HOST, cookie: await credentials("reader-alice", "s1", 1000) } });
    expect(response.status).toBe(400);
  });
});
