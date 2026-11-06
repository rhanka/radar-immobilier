import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startHarness, cookie, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";
import { fingerprintReaderProfile } from "../../src/artifacts/reader-profile.js";
import { APPROVAL_BASE_CSP } from "../../src/artifacts/reader-opening.js";
import { DESIGN_KIT_ASSETS, designKitAssetUrl } from "@radar/artifacts-host";

let h: Harness;
beforeAll(async () => { h = await startHarness("readerexchange", ["author-alice"]); });
beforeEach(async () => {
  // Independent reader scenarios share the same fixture producer.
  await h.pool.query("DELETE FROM artifacts.host_actor_rate WHERE storage_scope_id=$1 AND actor_id=$2",
    [h.config.storageScope, "author-alice"]);
});
afterAll(async () => { await h?.close(); });

type Baskets = Awaited<ReturnType<typeof publishedBaskets>>;

async function approvedExchangeUrl(app: ReturnType<Baskets["runtime"]>, f: Baskets) {
  const contentHost = `${f.releaseId}.pages.example.test`;
  const request = (url: string, init?: RequestInit) => app.request(url, {
    ...init, headers: { host: new URL(url).host, ...init?.headers },
  });
  const start = await request(`https://${contentHost}/__reader/start`);
  expect(start.status).toBe(303);
  const binding = start.headers.get("set-cookie")!.split(";")[0]!;
  const approvalUrl = start.headers.get("location")!;
  const appCookie = await cookie(f.data.contributor.sub);
  const fields = new URL(approvalUrl).searchParams;
  fields.set("releaseId", f.releaseId);
  fields.set("profileFingerprint", fingerprintReaderProfile((await f.stored().authority.getProfile(f.artifactId))!));
  // J1.3a: only an explicit choice records the consent and opens.
  fields.set("decision", "grant");
  const confirmation = await request(new URL(approvalUrl).origin + new URL(approvalUrl).pathname, {
    method: "POST", headers: { cookie: appCookie, origin: "https://app.example.test",
      "content-type": "application/x-www-form-urlencoded" }, body: fields.toString(),
  });
  expect(confirmation.status).toBe(303);
  return { request, binding, exchangeUrl: confirmation.headers.get("location")!, start };
}

describe("reader exchange browser recovery", () => {
  it("should keep the binding cookie for the 10-minute approval window", async () => {
    const f = await publishedBaskets(h);
    const { start } = await approvedExchangeUrl(f.runtime(), f);
    expect(start.headers.get("set-cookie")).toContain("Max-Age=600");
  });

  it("should default artifacts.reader_tickets expires_at to the 10-minute window", async () => {
    const def = await h.pool.query(
      "SELECT column_default FROM information_schema.columns WHERE table_schema='artifacts' AND table_name='reader_tickets' AND column_name='expires_at'");
    expect(def.rows[0].column_default).toContain("00:10:00");
    await h.pool.query("DELETE FROM artifacts.reader_tickets");
    const f = await publishedBaskets(h);
    await approvedExchangeUrl(f.runtime(), f);
    const ttl = await h.pool.query("SELECT extract(epoch FROM (expires_at - now())) AS ttl FROM artifacts.reader_tickets");
    expect(ttl.rows).toHaveLength(1);
    expect(Number(ttl.rows[0].ttl)).toBeGreaterThan(300);
    expect(Number(ttl.rows[0].ttl)).toBeLessThanOrEqual(600);
  });

  it("should keep the 401 JSON for non-browser exchange failures", async () => {
    const f = await publishedBaskets(h);
    const { request, binding, exchangeUrl } = await approvedExchangeUrl(f.runtime(), f);
    const forged = await request(exchangeUrl.replace(/ticket=[^&]*/, `ticket=${"f".repeat(64)}`), {
      headers: { cookie: binding },
    });
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: "unauthenticated" });
  });

  it("should restart reused tickets once, then show the neutral page without looping", async () => {
    const f = await publishedBaskets(h);
    const app = f.runtime();
    const { request, binding, exchangeUrl } = await approvedExchangeUrl(app, f);
    const browser = { cookie: binding, accept: "text/html,application/xhtml+xml" };
    const success = await request(exchangeUrl, { headers: browser });
    expect(success.status).toBe(303);
    expect(success.headers.get("location")).not.toContain("ticket=");
    const restart = await request(exchangeUrl, { headers: browser });
    expect(restart.status).toBe(303);
    expect(restart.headers.get("location")).toBe("/__reader/start");
    const retry = restart.headers.getSetCookie().find((header) => header.startsWith("__Host-preview-retry="))!
      .split(";")[0]!;
    const expired = await request(exchangeUrl, { headers: { ...browser, cookie: `${binding}; ${retry}` } });
    expect(expired.status).toBe(401);
    expect(expired.headers.get("content-type")).toContain("text/html");
    expect(expired.headers.get("location")).toBeNull();
    expect(expired.headers.get("content-security-policy")).toBe(APPROVAL_BASE_CSP);
    const expiredBody = await expired.text();
    expect(expiredBody).toContain("Ce lien d'ouverture a expiré");
    expect(expiredBody).toContain("Rouvrir la page");
    expect(expiredBody).toContain('href="/__reader/start"');
    expect(expiredBody).not.toContain("/api/v1/artifacts/reader/design/");
    for (const asset of DESIGN_KIT_ASSETS) {
      expect(expiredBody).toContain(designKitAssetUrl(asset));
    }
    const contentHost = new URL(exchangeUrl).host;
    const styles = [...expiredBody.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]!);
    expect(styles).toHaveLength(DESIGN_KIT_ASSETS.length);
    for (const href of styles) {
      const css = await request(`https://${contentHost}${href}`);
      expect(css.status, href).toBe(200);
      expect(css.headers.get("content-type")).toContain("text/css");
      expect(await css.text()).toContain("--st-");
    }
    for (const secret of [f.artifactId, f.releaseId, "unauthenticated"]) {
      expect(expiredBody.includes(secret), secret).toBe(false);
    }
    const again = await request(exchangeUrl, { headers: { ...browser, cookie: `${binding}; ${retry}` } });
    expect(again.status).toBe(401);
    expect(again.headers.get("location")).toBeNull();
    expect(await again.text()).toBe(expiredBody);
  });

  it("should restart expired tickets with the same neutral page", async () => {
    const f = await publishedBaskets(h);
    const app = f.runtime();
    const contentHost = `${f.releaseId}.pages.example.test`;
    const { request, binding, exchangeUrl } = await approvedExchangeUrl(app, f);
    await h.pool.query("UPDATE artifacts.reader_tickets SET expires_at=now()-interval '1 second'");
    const browser = { cookie: binding, accept: "text/html" };
    const restart = await request(exchangeUrl, { headers: browser });
    expect(restart.status).toBe(303);
    expect(restart.headers.get("location")).toBe("/__reader/start");
    const retry = restart.headers.getSetCookie().find((header) => header.startsWith("__Host-preview-retry="))!
      .split(";")[0]!;
    const expiredBody = await request(exchangeUrl,
      { headers: { ...browser, cookie: `${binding}; ${retry}` } }).then((r) => r.text());
    const unknownBody = await request(`https://${contentHost}/__reader/exchange?ticket=${"e".repeat(64)}`,
      { headers: { ...browser, cookie: `${binding}; ${retry}` } }).then((r) => r.text());
    expect(expiredBody).toBe(unknownBody);
    expect(expiredBody).toContain("Ce lien d'ouverture a expiré");
    expect(expiredBody.includes(f.artifactId)).toBe(false);
    expect(expiredBody.includes(f.releaseId)).toBe(false);
  });
});
