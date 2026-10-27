import { afterAll, beforeAll, expect, it } from "vitest";
import pg from "pg";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { createSharedReaderTickets } from "../../src/artifacts/reader-tickets.js";
import { startHarness, cookie, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";
import { fingerprintReaderProfile } from "../../src/artifacts/reader-profile.js";

describeDb("stored reader approval and single-use exchange", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness("l3opening", ["author-alice"]); });
  afterAll(async () => { await h?.close(); });
  it("should require app confirmation and exchange once across independently composed readers", async () => {
    const f = await publishedBaskets(h);
    const app = f.runtime();
    const request = (url: string, init?: RequestInit) => app.request(url, {
      ...init, headers: { host: new URL(url).host, ...init?.headers },
    });
    const entry = await request(`https://${f.host}/`);
    expect(entry.status).toBe(303);
    expect(entry.headers.get("location")).toBe("/__reader/start");
    const start = await request(`https://${f.host}/__reader/start`);
    expect(start.status).toBe(303);
    const pinned = await request(`https://${f.releaseId}.pinned.pages.example.test/__reader/start`);
    expect(pinned.status).toBe(303);
    expect(new URL(pinned.headers.get("location")!).searchParams.get("artifactId")).toBe(f.artifactId);
    expect(new URL(pinned.headers.get("location")!).searchParams.get("origin"))
      .toBe(`https://${f.releaseId}.pinned.pages.example.test`);
    const initialCookie = start.headers.get("set-cookie")!.split(";")[0]!;
    expect(start.headers.get("set-cookie")).toContain("Secure; HttpOnly; SameSite=Lax");
    const approvalUrl = start.headers.get("location")!;
    const appCookie = await cookie(f.data.contributor.sub);
    const summary = await request(approvalUrl, { headers: { cookie: appCookie } });
    expect(summary.status).toBe(200);
    expect(await summary.text()).toContain("Autoriser et ouvrir");
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
      headers: { host: f.host, cookie: initialCookie },
    })));
    expect(exchanges.map((response) => response.status).sort()).toEqual([303, 401]);
    const success = exchanges.find((response) => response.status === 303)!;
    expect(success.headers.get("location")).not.toContain("ticket=");
    const sessionCookie = success.headers.getSetCookie().find((header) => header.startsWith("__Host-preview-session="))!;
    expect(sessionCookie).toContain("Secure; HttpOnly");
    expect(sessionCookie).not.toContain("radar_session");
    const page = await request(`https://${f.host}${success.headers.get("location")}`, {
      headers: { cookie: sessionCookie.split(";")[0]! },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("/main.js?grant=");
    expect((await request(exchangeUrl, { headers: { cookie: initialCookie } })).status).toBe(401);
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
      const before = await authority.getAuthorizationVersion(f.artifactId);
      await h.pool.query("UPDATE account_users SET status='suspended' WHERE sub=$1", [input.readerSub]);
      expect(await authority.getAuthorizationVersion(f.artifactId)).not.toBe(before);
      expect((await authority.getRights(input.readerSub, f.artifactId))?.approved).toBe(false);
    } finally { await pool2.end(); }
  });
});
