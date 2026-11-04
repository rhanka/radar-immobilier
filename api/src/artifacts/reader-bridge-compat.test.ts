import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mintGrant } from "./preview-grant.js";
import { createFixtureAuthority, fingerprintReaderProfile } from "./reader-profile.js";
import { createReaderContentApp } from "./content-serve.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import {
  GRANT_SECRET,
  HOST,
  ISSUER,
  SESSION_SECRET,
  credentials,
} from "./reader-test-fixture.js";

/**
 * Lot I2 B2: a basket page published with the pre-I2 reader bridge keeps
 * working without republication. The release still stores the exact legacy
 * bytes, but the host serves them upgraded (consent navigation), while
 * every other file goes out byte-identical and the old token flow
 * (grant in the URL, x-preview-grant header, renew) is unchanged.
 */
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const FINGERPRINT = fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] });
const LEGACY_READER_JS = readFileSync(
  new URL("../../../packages/artifacts-host/src/reader-bridge-legacy.fixture.txt", import.meta.url), "utf8");
const APP_JS = "window.ImmoArtifact = { mount: function (root) { root.textContent = 'signals'; } };";

function buildApp() {
  return createReaderContentApp({ authority: createFixtureAuthority(), readOperation: (async () => ({})) as never,
    contentBase: "pages.example.test", grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET,
    issuer: ISSUER,
    releaseFiles: createMemoryReleaseFiles([
      { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html",
        body: `<!doctype html><html><head></head><body><script src="/reader.js"></script><script src="/app.js"></script></body></html>` },
      { artifactId: ARTIFACT, releaseId: RELEASE, path: "/reader.js", body: LEGACY_READER_JS },
      { artifactId: ARTIFACT, releaseId: RELEASE, path: "/app.js", body: APP_JS },
    ]),
    now: () => 1_000 });
}

async function documentGrant(): Promise<string> {
  return mintGrant({ ...ISSUER, host: HOST, artifactId: ARTIFACT, releaseId: RELEASE,
    readerSub: "reader-alice", sessionId: "session-1", profileName: "demo",
    policyRevision: "pol-001", profileFingerprint: FINGERPRINT }, GRANT_SECRET, 1_000);
}

describe("legacy published basket page", () => {
  it("should serve the stored legacy bridge upgraded to the consent flow", async () => {
    const app = buildApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await documentGrant();
    const res = await app.request(`http://${HOST}/reader.js?grant=${grant}`, {
      headers: { host: HOST, cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    const body = await res.text();
    expect(body).not.toBe(LEGACY_READER_JS);
    expect(body).toContain('basket_consent_required: "consent",');
    expect(body).toContain('location.assign("/__reader/consent")');
    // Stable across fetches: the upgraded output is no longer legacy.
    const second = await app.request(`http://${HOST}/reader.js`, {
      headers: { host: HOST, cookie, "x-preview-grant": grant },
    });
    expect(await second.text()).toBe(body);
  });

  it("should serve every other published file byte-identical", async () => {
    const app = buildApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await documentGrant();
    const res = await app.request(`http://${HOST}/app.js?grant=${grant}`, {
      headers: { host: HOST, cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(APP_JS);
  });

  it("should still refuse the first H5 call with the typed consent code", async () => {
    const app = buildApp();
    const cookie = await credentials("reader-alice", "session-1", 1_000);
    const grant = await documentGrant();
    const api = await app.request(`http://${HOST}/__reader/api/workspaces.list.v1?grant=${grant}`, {
      headers: { host: HOST, cookie },
    });
    expect(api.status).toBe(403);
    expect(((await api.json()) as { error: { code: string } }).error.code).toBe("basket_consent_required");
  });
});
