/**
 * J1.1 SPA history fallback: extension-less navigations serve the release
 * index.html on both content hosts without breaking real files, missing
 * assets (still 404) or the reserved /__reader, /__artifacts, /__app
 * subtrees. New file on purpose: no existing content-serve test is edited.
 */
import { describe, expect, it } from "vitest";
import { createReaderContentApp } from "./content-serve.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { mintGrant } from "./preview-grant.js";
import {
  GRANT_SECRET,
  HOST,
  ISSUER,
  SESSION_SECRET,
  credentials,
  fixtureReaderDeps,
} from "./reader-test-fixture.js";

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE = "123e4567-e89b-12d3-a456-426614174001";
const RELEASE_HOST = `${RELEASE}.pages.example.test`;
const INDEX = "<!doctype html><html><head><title>Signals</title></head><body><div id=app></div></body></html>";

const FINGERPRINT = fingerprintReaderProfile({
  name: "demo",
  policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"],
});

function spaApp() {
  const releaseFiles = createMemoryReleaseFiles([
    { artifactId: ARTIFACT, releaseId: RELEASE, path: "/index.html", body: INDEX },
    { artifactId: ARTIFACT, releaseId: RELEASE, path: "/assets/app.js", body: "console.log(1)" },
    { artifactId: ARTIFACT, releaseId: RELEASE, path: "/municipalities.geojson", body: "{}" },
  ]);
  return createReaderContentApp({ ...fixtureReaderDeps(), contentBase: "pages.example.test",
    grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, issuer: ISSUER,
    now: () => 1_000, releaseFiles });
}

async function token(host: string = HOST): Promise<string> {
  return mintGrant({ ...ISSUER, host, artifactId: ARTIFACT, releaseId: RELEASE,
    readerSub: "reader-alice", sessionId: "s1", profileName: "demo",
    policyRevision: "pol-001", profileFingerprint: FINGERPRINT }, GRANT_SECRET, 1000);
}

async function nav(app: ReturnType<typeof spaApp>, path: string, cookie: string | undefined,
  grant: string | undefined, accept: string | undefined, host = HOST): Promise<Response> {
  const url = `http://${host}${path}${grant ? `?grant=${grant}` : ""}`;
  return app.request(url, { headers: {
    host, ...(cookie ? { cookie } : {}), ...(accept ? { accept } : {}) } });
}

describe("SPA history fallback on the content hosts", () => {
  it("should serve index.html for an extension-less navigation with Accept text/html", async () => {
    const app = spaApp();
    const grant = await token();
    const cookie = await credentials("reader-alice", "s1", 1000);
    const res = await nav(app, "/geo/valleyfield", cookie, grant, "text/html");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
    expect(res.headers.get("content-security-policy")).toContain("worker-src 'self'");
  });

  it("should serve the fallback on the exact release host too", async () => {
    const app = spaApp();
    const grant = await token(RELEASE_HOST);
    const cookie = await credentials("reader-alice", "s1", 1000);
    const res = await nav(app, "/geo/valleyfield", cookie, grant,
      "text/html,application/xhtml+xml", RELEASE_HOST);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
  });

  it("should keep real files byte-identical and never shadow them", async () => {
    const app = spaApp();
    const grant = await token();
    const cookie = await credentials("reader-alice", "s1", 1000);
    const js = await nav(app, "/assets/app.js", cookie, grant, "text/html");
    expect(js.status).toBe(200);
    expect(await js.text()).toBe("console.log(1)");
    const geojson = await nav(app, "/municipalities.geojson", cookie, grant, "text/html");
    expect(geojson.status).toBe(200);
    expect(geojson.headers.get("content-type")).toBe("application/json");
  });

  it("should keep 404 for missing assets and non-HTML accepts", async () => {
    const app = spaApp();
    const grant = await token();
    const cookie = await credentials("reader-alice", "s1", 1000);
    const missing = await nav(app, "/assets/missing.js", cookie, grant, "text/html");
    expect(missing.status).toBe(404);
    const apiAccept = await nav(app, "/geo/valleyfield", cookie, grant, "application/json");
    expect(apiAccept.status).toBe(404);
    expect((await apiAccept.json()) as { error: string }).toEqual({ error: "not_found" });
  });

  it("should never fall back on reserved subtrees", async () => {
    const app = spaApp();
    const grant = await token();
    const cookie = await credentials("reader-alice", "s1", 1000);
    for (const path of ["/__app/me", "/__reader/consent", "/__artifacts/tiles/v1/osm/20/1/1"]) {
      const res = await nav(app, path, cookie, grant, "text/html");
      expect(res.status, path).not.toBe(200);
      expect(await res.text(), path).not.toContain("<title>Signals</title>");
    }
  });

  it("should still refuse anonymous navigations before any fallback", async () => {
    const app = spaApp();
    const res = await nav(app, "/geo/valleyfield", undefined, undefined, "text/html");
    expect(res.status).toBe(401);
  });
});
