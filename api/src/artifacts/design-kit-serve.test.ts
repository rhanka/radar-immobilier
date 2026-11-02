import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { DESIGN_KIT_ASSETS, DESIGN_KIT_VERSION, validatePublishFilePath } from "@radar/artifacts-host";
import { mintGrant } from "./preview-grant.js";
import { fingerprintReaderProfile } from "./reader-profile.js";
import { createReaderContentApp } from "./content-serve.js";
import { createMemoryReleaseFiles } from "./release-files.js";
import { mintSessionCookie } from "./preview-session.js";
import {
  GRANT_SECRET,
  HOST,
  ISSUER,
  SESSION_SECRET,
  credentials,
  fixtureReaderDeps,
  makeApp,
  request,
} from "./reader-test-fixture.js";

const FINGERPRINT = fingerprintReaderProfile({ name: "demo", policyRevision: "pol-001",
  capabilities: ["geo.read", "signals.protected-read"] });
const ARTIFACT_ID = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE_ID = "123e4567-e89b-12d3-a456-426614174001";
const PINNED_HOST = `${RELEASE_ID}.pinned.pages.example.test`;

async function authorized() {
  const app = makeApp();
  const cookie = await credentials("reader-alice", "session-1", 1_000);
  const grant = await mintGrant(
    { ...ISSUER, host: HOST, artifactId: ARTIFACT_ID, releaseId: RELEASE_ID,
      readerSub: "reader-alice", sessionId: "session-1", profileName: "demo",
      policyRevision: "pol-001", profileFingerprint: FINGERPRINT },
    GRANT_SECRET,
    1_000,
  );
  return { app, cookie, grant };
}

function designUrl(asset: (typeof DESIGN_KIT_ASSETS)[number]): string {
  return `/__artifacts/design/${DESIGN_KIT_VERSION}/${asset.sha256Hex}/${asset.file}`;
}

describe("reserved design-kit path", () => {
  it("should serve the pinned stylesheets to an authorized reader on the content origin", async () => {
    const { app, cookie, grant } = await authorized();
    for (const asset of DESIGN_KIT_ASSETS) {
      const res = await request(app, designUrl(asset), cookie, grant);
      expect(res.status, asset.file).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/css");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.text()).toContain("--st-");
    }
  });

  it("should serve the pinned stylesheets without any reader authorization", async () => {
    // Design-kit bytes are public upstream content: sha256-pinned, identical
    // for every page, no tenant data. Page <link> tags carry no grant, so an
    // authorized page view must get its styles with or without reader.js.
    const { app } = await authorized();
    for (const asset of DESIGN_KIT_ASSETS) {
      const anonymous = await request(app, designUrl(asset));
      expect(anonymous.status, asset.file).toBe(200);
      expect(anonymous.headers.get("content-type")).toContain("text/css");
      expect(await anonymous.text()).toContain("--st-");
      const forged = await request(app, designUrl(asset), undefined, "forged-grant");
      expect(forged.status, asset.file).toBe(200);
      expect(await forged.text()).toContain("--st-");
    }
  });

  it("should refuse unknown or forged design URLs", async () => {
    const { app, cookie, grant } = await authorized();
    const [first] = DESIGN_KIT_ASSETS;
    for (const forged of [
      `/__artifacts/design/ds-0.00.00-r9/${first!.sha256Hex}/${first!.file}`,
      `/__artifacts/design/${DESIGN_KIT_VERSION}/${"0".repeat(64)}/${first!.file}`,
      `/__artifacts/design/${DESIGN_KIT_VERSION}/${first!.sha256Hex}/other.css`,
      `/__artifacts/design/${DESIGN_KIT_VERSION}/${first!.sha256Hex}/..%2Findex.html`,
    ]) {
      expect((await request(app, forged)).status, forged).toBe(404);
      expect((await request(app, forged, cookie, grant)).status, forged).toBe(404);
    }
  });

  it("should keep page content and reader APIs closed without authorization", async () => {
    const { app } = await authorized();
    expect((await request(app, "/")).status).toBe(401);
    expect((await request(app, "/main.js")).status).toBe(401);
    expect((await request(app, "/main.js", undefined, "forged-grant")).status).toBe(401);
    expect((await request(app, "/__reader/api/baskets.search.v1?citySlug=valleyfield")).status).toBe(401);
  });

  it("should keep author files from shadowing the reserved prefix", async () => {
    // The publish policy reserves the __artifacts first segment, so no
    // publication can claim the design path; the kit costs no budget bytes.
    expect(validatePublishFilePath("__artifacts/design/x/y/sent-tech.css")).not.toEqual([]);
    const { app, cookie, grant } = await authorized();
    const res = await request(app, `/__artifacts/design/${DESIGN_KIT_VERSION}/${DESIGN_KIT_ASSETS[0]!.sha256Hex}/sent-tech.css/extra`, cookie, grant);
    expect(res.status).toBe(404);
  });
});

function makeReloadApp(nowMs: number) {
  const opening = new Hono();
  opening.get("/__reader/start", (c) => c.html(
    `<!doctype html><html><head>` +
    DESIGN_KIT_ASSETS.map((asset) => `<link rel="stylesheet" href="${designUrl(asset)}">`).join("") +
    `</head><body>Reopen the page</body></html>`,
  ));
  const releaseFiles = createMemoryReleaseFiles([
    { artifactId: ARTIFACT_ID, releaseId: RELEASE_ID, path: "/index.html",
      body: "<!doctype html><html><head></head><body>page</body></html>" },
  ]);
  return createReaderContentApp({ ...fixtureReaderDeps(), contentBase: "pages.example.test",
    grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET, issuer: ISSUER,
    releaseFiles, openingContent: opening, now: () => nowMs });
}

function sessionWithResource(): string {
  const resource = { ...ISSUER, host: PINNED_HOST, artifactId: ARTIFACT_ID, releaseId: RELEASE_ID,
    readerSub: "reader-alice", sessionId: "session-1", profileName: "demo",
    policyRevision: "pol-001", profileFingerprint: FINGERPRINT };
  return mintSessionCookie({ sid: "session-1", readerSub: "reader-alice", artifactId: ARTIFACT_ID,
    createdAt: 1_000, expiresAt: 1_000 + 900_000, resource }, SESSION_SECRET).split(";")[0]!;
}

async function pinnedRequest(app: ReturnType<typeof makeApp>, path: string, cookie?: string, grant?: string): Promise<Response> {
  const url = `http://${PINNED_HOST}${path}${grant ? `${path.includes("?") ? "&" : "?"}grant=${grant}` : ""}`;
  return app.request(url, { headers: { host: PINNED_HOST, ...(cookie ? { cookie } : {}) } });
}

describe("reload after the grant expired", () => {
  it("should redirect a document reload with a stale grant to the styled reader opening", async () => {
    const app = makeReloadApp(300_000);
    const stale = await mintGrant(
      { ...ISSUER, host: PINNED_HOST, artifactId: ARTIFACT_ID, releaseId: RELEASE_ID,
        readerSub: "reader-alice", sessionId: "session-1", profileName: "demo",
        policyRevision: "pol-001", profileFingerprint: FINGERPRINT },
      GRANT_SECRET,
      1_000,
    );
    const reload = await pinnedRequest(app, "/", sessionWithResource(), stale);
    expect(reload.status).toBe(303);
    expect(reload.headers.get("location")).toBe("/__reader/start");
    const opening = await pinnedRequest(app, "/__reader/start");
    expect(opening.status).toBe(200);
    expect(opening.headers.get("content-type")).toContain("text/html");
    expect(await opening.text()).toContain("__artifacts/design/");
  });

  it("should redirect a document reload with a forged grant to the styled reader opening", async () => {
    const app = makeReloadApp(300_000);
    for (const path of ["/", "/index.html"]) {
      const reload = await pinnedRequest(app, path, undefined, "forged-grant");
      expect(reload.status, path).toBe(303);
      expect(reload.headers.get("location"), path).toBe("/__reader/start");
    }
  });

  it("should keep non-document paths closed when authorization fails", async () => {
    const app = makeReloadApp(300_000);
    expect((await pinnedRequest(app, "/app.js")).status).toBe(401);
    expect((await pinnedRequest(app, "/app.js", undefined, "forged-grant")).status).toBe(401);
  });

  it("should recover a grant-less reload on the pinned host into a fresh grant redirect", async () => {
    const app = makeReloadApp(300_000);
    const reload = await pinnedRequest(app, "/", sessionWithResource());
    expect(reload.status).toBe(303);
    const location = reload.headers.get("location")!;
    expect(location.startsWith("/?grant=")).toBe(true);
    expect(new URL(location, `http://${PINNED_HOST}`).searchParams.get("grant")).not.toBe("");
  });
});
