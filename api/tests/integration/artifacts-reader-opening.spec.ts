import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import pg from "pg";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { createSharedReaderTickets } from "../../src/artifacts/reader-tickets.js";
import { startHarness, cookie, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";
import { fingerprintReaderProfile } from "../../src/artifacts/reader-profile.js";
import { APPROVAL_BASE_CSP, APPROVAL_STYLE_HASH } from "../../src/artifacts/reader-opening.js";
import { DESIGN_KIT_ASSETS, designKitAssetUrl } from "@radar/artifacts-host";
import { createStoredReader } from "../../src/artifacts/reader-storage.js";
import { createReaderContentApp } from "../../src/artifacts/content-serve.js";
import { GRANT_SECRET, SESSION_SECRET, ISSUER } from "../../src/artifacts/reader-test-fixture.js";

describeDb("stored reader approval and single-use exchange", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness("l3opening", ["author-alice"]); });
  beforeEach(async () => {
    // Independent reader scenarios share the same fixture producer.
    await h.pool.query("DELETE FROM artifacts.host_actor_rate WHERE storage_scope_id=$1 AND actor_id=$2",
      [h.config.storageScope, "author-alice"]);
  });
  afterAll(async () => { await h?.close(); });
  it("should retain already issued pinned credentials independently of the current publication pointer", async () => {
    const f = await publishedBaskets(h);
    const host = `${f.releaseId}.pinned.pages.example.test`;
    const credential = await f.credentials(f.data.contributor.sub, f.releaseId, host);
    const publication = await h.control.handle("publish", "author-alice", { artifactId: f.artifactId,
      files: f.files.map((file) => ({ ...file, text: file.text + "\n" })), idempotencyKey: `${f.releaseId}-next` });
    expect(publication.status).toBe(201);
    expect((publication.body as { releaseId: string }).releaseId).not.toBe(f.releaseId);
    const app = f.runtime();
    const request = () => app.request(`https://${host}/main.js?grant=${credential.grant}`, {
      headers: { host, cookie: credential.cookie } });
    expect((await request()).status).toBe(200);
    await h.pool.query("DELETE FROM artifacts.artifact_current WHERE artifact_id=$1", [f.artifactId]);
    expect((await request()).status).toBe(200);
    await h.pool.query("DELETE FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2", [f.artifactId, f.data.contributor.sub]);
    expect((await request()).status).toBe(401);
  });

  it("should restart disconnected opening through existing login with a fresh binding", async () => {
    const f = await publishedBaskets(h), app = f.runtime();
    const origin = `https://${f.releaseId}.pinned.pages.example.test`;
    const request = (url: string, cookieHeader = "") => app.request(url, { headers: { host: new URL(url).host, cookie: cookieHeader } });
    const first = await request(origin + "/__reader/start");
    const login = await request(first.headers.get("location")!);
    expect(login.status).toBe(303);
    const loginUrl = new URL(login.headers.get("location")!, "https://app.example.test");
    expect(loginUrl.pathname).toBe("/api/v1/auth/login");
    const resume = new URL(loginUrl.searchParams.get("returnTo")!, loginUrl.origin);
    expect(resume.pathname).toBe("/api/v1/artifacts/reader/resume");
    const restarted = await request(resume.href, await cookie(f.data.contributor.sub));
    expect(restarted.headers.get("location")).toBe(origin + "/__reader/start");
    const fresh = await request(restarted.headers.get("location")!);
    expect(fresh.headers.get("set-cookie")).not.toBe(first.headers.get("set-cookie"));
    expect((await request(fresh.headers.get("location")!, await cookie(f.data.contributor.sub))).status).toBe(200);
    resume.searchParams.set("origin", "https://foreign.test");
    expect((await request(resume.href)).status).toBe(404);
  });

  it("should keep a delayed read open across unrelated account and ACL changes", async () => {
    const f = await publishedBaskets(h);
    const storage = createStoredReader(h.pool, h.config.storageScope, "pages.example.test", { getBlob: async (key) => {
      await h.pool.query("UPDATE account_users SET status='suspended' WHERE sub=$1", [f.data.outsider.sub]);
      await h.pool.query("DELETE FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2", [f.artifactId, f.data.outsider.sub]);
      return h.blobs.getBlob(key);
    } });
    const app = createReaderContentApp({ ...storage, contentBase: "pages.example.test", issuer: ISSUER,
      grantSecret: GRANT_SECRET, sessionSecret: SESSION_SECRET });
    const credential = await f.credentials(f.data.contributor.sub);
    const url = `https://${f.host}/main.js?grant=${credential.grant}`;
    const request = () => app.request(url, { headers: { host: f.host, cookie: credential.cookie } });
    expect((await request()).status).toBe(200);
    await h.pool.query("UPDATE account_users SET status='suspended' WHERE sub=$1", [f.data.contributor.sub]);
    expect((await request()).status).toBe(401);
  });
  it("should require app confirmation and exchange once across independently composed readers", async () => {
    const f = await publishedBaskets(h);
    const contentHost = `${f.releaseId}.pinned.pages.example.test`;
    const app = f.runtime();
    const request = (url: string, init?: RequestInit) => app.request(url, {
      ...init, headers: { host: new URL(url).host, ...init?.headers },
    });
    const entry = await request(`https://${f.host}/`);
    expect(entry.status).toBe(303);
    expect(entry.headers.get("location")).toBe("/__reader/start");
    const start = await request(`https://${f.host}/__reader/start`);
    expect(start.status).toBe(303);
    expect(start.headers.get("location")).toBe(`https://${contentHost}/__reader/start`);
    const pinned = await request(`https://${f.releaseId}.pinned.pages.example.test/__reader/start`);
    expect(pinned.status).toBe(303);
    expect(new URL(pinned.headers.get("location")!).searchParams.get("artifactId")).toBe(f.artifactId);
    expect(new URL(pinned.headers.get("location")!).searchParams.get("origin"))
      .toBe(`https://${f.releaseId}.pinned.pages.example.test`);
    const initialCookie = pinned.headers.get("set-cookie")!.split(";")[0]!;
    expect(pinned.headers.get("set-cookie")).toContain("Secure; HttpOnly; SameSite=Lax");
    const approvalUrl = pinned.headers.get("location")!;
    const appCookie = await cookie(f.data.contributor.sub);
    const summary = await request(approvalUrl, { headers: { cookie: appCookie } });
    expect(summary.status).toBe(200);
    expect(summary.headers.get("referrer-policy")).toBe("same-origin");
    expect(summary.headers.get("content-security-policy"))
      .toBe(`default-src 'none'; style-src 'self' '${APPROVAL_STYLE_HASH}'; ` +
        `form-action 'self' https://${contentHost}; frame-ancestors 'none'; base-uri 'none'`);
    const approvalHtml = await summary.text();
    expect(approvalHtml).toContain("Autoriser et ouvrir");
    expect(approvalHtml).toContain('data-st-theme="sent-tech"');
    expect(approvalHtml).toContain("st-card");
    expect(approvalHtml).toContain("st-button--primary");
    expect(approvalHtml).toContain("/__artifacts/design/");
    expect(approvalHtml).toContain("<style>");
    const pinnedSummary = await request(pinned.headers.get("location")!, { headers: { cookie: appCookie } });
    expect(pinnedSummary.status).toBe(200);
    expect(pinnedSummary.headers.get("content-security-policy"))
      .toContain(`form-action 'self' https://${f.releaseId}.pinned.pages.example.test;`);
    for (const origin of ["https://foreign.test", `https://${f.host}.foreign.test`]) {
      const forged = new URL(approvalUrl);
      forged.searchParams.set("origin", origin);
      const rejected = await request(forged.href, { headers: { cookie: appCookie } });
      expect(rejected.status).toBe(401);
      expect(rejected.headers.get("content-security-policy")).toBe(APPROVAL_BASE_CSP);
    }
    expect((await h.pool.query("SELECT count(*) FROM artifacts.reader_tickets")).rows[0].count).toBe("0");
    const fields = new URL(approvalUrl).searchParams;
    fields.set("releaseId", f.releaseId);
    fields.set("profileFingerprint", fingerprintReaderProfile((await f.stored().authority.getProfile(f.artifactId))!));
    const body = fields.toString();
    const approve = (origin: string, cookieHeader = appCookie) => request(new URL(approvalUrl).origin + new URL(approvalUrl).pathname, {
      method: "POST", headers: { cookie: cookieHeader, origin, "content-type": "application/x-www-form-urlencoded" }, body,
    });
    expect((await approve("https://foreign.test")).status).toBe(403);
    expect((await approve("https://app.example.test", "")).status).toBe(401);
    const substituted = await request(new URL(approvalUrl).origin + new URL(approvalUrl).pathname, {
      method: "POST", headers: { cookie: appCookie, origin: "https://app.example.test",
        "content-type": "application/x-www-form-urlencoded" }, body: body.replace(f.releaseId, "forged-release"),
    });
    expect(substituted.status).toBe(401);
    const confirmation = await approve("https://app.example.test");
    expect(confirmation.status).toBe(303);
    const exchangeUrl = confirmation.headers.get("location")!;
    const noBinding = await request(exchangeUrl);
    expect(noBinding.status).toBe(401);
    const exchanges = await Promise.all([app, f.runtime()].map((runtime) => runtime.request(exchangeUrl, {
      headers: { host: contentHost, cookie: initialCookie },
    })));
    expect(exchanges.map((response) => response.status).sort()).toEqual([303, 401]);
    const success = exchanges.find((response) => response.status === 303)!;
    expect(success.headers.get("location")).not.toContain("ticket=");
    const sessionCookie = success.headers.getSetCookie().find((header) => header.startsWith("__Host-preview-session="))!;
    expect(sessionCookie).toContain("Secure; HttpOnly");
    expect(sessionCookie).not.toContain("radar_session");
    const page = await request(`https://${contentHost}${success.headers.get("location")}`, {
      headers: { cookie: sessionCookie.split(";")[0]! },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('src="/main.js"');
    expect((await request(exchangeUrl, { headers: { cookie: initialCookie } })).status).toBe(401);
  });
  it("should serve the official kit stylesheets publicly on the approval origin", async () => {
    const f = await publishedBaskets(h);
    const app = f.runtime();
    for (const asset of DESIGN_KIT_ASSETS) {
      const res = await app.request(`https://app.example.test${designKitAssetUrl(asset)}`, {
        headers: { host: "app.example.test" },
      });
      expect(res.status, asset.file).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/css");
      expect(res.headers.get("cache-control")).toContain("immutable");
      expect(await res.text()).toContain("--st-");
    }
    const unknown = await app.request("https://app.example.test/__artifacts/design/ds-0.00.00-r9/x/y.css", {
      headers: { host: "app.example.test" },
    });
    expect(unknown.status).toBe(404);
  });
  it("should retain single-use semantics on separate PostgreSQL connections and expire by DB time", async () => {
    const f = await publishedBaskets(h);
    const authority = f.stored().authority;
    const input = { browserBinding: "b".repeat(64), artifactId: f.artifactId, releaseId: f.releaseId,
      origin: `https://${f.host}`, readerSub: f.data.contributor.sub, profileName: "radar-baskets",
      policyRevision: "basket-read-v1", profileFingerprint: "c".repeat(64), returnTarget: "/" };
    const pool2 = new pg.Pool(h.pool.options);
    try {
      const first = createSharedReaderTickets(h.pool);
      const second = createSharedReaderTickets(pool2);
      const ticket = await first.mint(input);
      const results = await Promise.all([first, second].map((store) => store.consume(ticket.ticket, input.browserBinding)));
      expect(results.filter(Boolean)).toHaveLength(1);
      const expired = await second.mint(input);
      await h.pool.query("UPDATE artifacts.reader_tickets SET expires_at=now()-interval '1 second'");
      expect(await first.consume(expired.ticket, input.browserBinding)).toBeNull();
      const before = await authority.getAuthorizationVersion(f.artifactId, input.readerSub, f.releaseId);
      await h.pool.query("UPDATE account_users SET status='suspended' WHERE sub=$1", [input.readerSub]);
      expect(await authority.getAuthorizationVersion(f.artifactId, input.readerSub, f.releaseId)).not.toBe(before);
      expect((await authority.getRights(input.readerSub, f.artifactId))?.approved).toBe(false);
    } finally { await pool2.end(); }
  });
});
