import { chromium, expect as expectBrowser, type Browser } from "@playwright/test";
import { getRequestListener } from "@hono/node-server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { cookie, startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";
import { startBrowserHttps } from "./artifacts-baskets-browser.helpers.js";
const expectUi = expectBrowser.configure({ timeout: 1500 });

// Explicit opt-in: the default CI API image has no browser installed.
describeDb.skipIf(process.env.ARTIFACTS_BROWSER_ACCEPTANCE !== "1")("published HTML/CSS/JS Chromium acceptance", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness("l3browser", ["author-alice"]); });
  afterAll(async () => { await h?.close(); });
  it.each([{ eol: "\n", republish: false }, { eol: "\r\n", republish: false }, { eol: "\n", republish: true }])(
    "should read baskets through quoted HTML attributes and parameterized navigation with $eol and republish=$republish", async ({ eol, republish }) => {
    const f = await publishedBaskets(h, { native: true, eol });
    let releases = [{ host: f.host, version: "one" }];
    if (republish) {
      const publication = await h.control.handle("publish", "author-alice", { artifactId: f.artifactId,
        files: f.files.map((file) => ({ ...file, text: file.text.replace('data-version="one"', 'data-version="two"') })),
        idempotencyKey: `${f.releaseId}-second` });
      expect(publication.status).toBe(201);
      const second = (publication.body as { releaseId: string }).releaseId;
      expect(second).not.toBe(f.releaseId);
      releases = [{ host: `${f.releaseId}.pinned.pages.example.test`, version: "one" },
        { host: `${second}.pinned.pages.example.test`, version: "two" }];
    }
    const app = f.runtime();
    let statuses: Record<string, number> = {};
    let requests: { host: string; method: string; path: string; origin: string | null; cookie: string; cacheControl: string | null }[] = [];
    const server = await startBrowserHttps(getRequestListener(async (request) => {
      const url = new URL(request.url);
      const response = await app.fetch(request);
      statuses[url.pathname] = response.status;
      requests.push({ host: url.host, method: request.method, path: url.pathname, origin: request.headers.get("origin"),
        cookie: request.headers.get("cookie") ?? "",
        cacheControl: response.headers.get("cache-control") });
      return response;
    }));
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true, args: server.args });
      const openings = [[f.data.contributor.sub, 2], [f.data.moderator.sub, 1]].flatMap(([sub, count]) =>
        releases.map((release) => ({ sub: sub as string, count: count as number, ...release })));
      for (const { sub, count, host, version } of openings) {
        statuses = {};
        requests = [];
        // The certificate is ephemeral and restricted to this loopback fixture.
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const [name, value] = (await cookie(sub)).split("=") as [string, string];
        await context.addCookies([{ name, value, domain: "app.example.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const diagnostics: unknown[] = [];
        let htmlCsp = "";
        const pending: Promise<void>[] = [];
        const redact = (value: string) => value.replace(/([?&](?:grant|ticket|binding)=)[^&\s"'<>]+/g, "$1[redacted]")
          .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]");
        page.on("console", (message) => diagnostics.push({ console: message.type(), text: redact(message.text()) }));
        page.on("requestfailed", (request) => diagnostics.push({ url: redact(request.url()), failure: request.failure() }));
        page.on("response", (response) => {
          const url = new URL(response.url());
          if (url.host.endsWith(".pages.example.test") && response.status() === 200 &&
            response.headers()["content-type"]?.startsWith("text/html")) htmlCsp = response.headers()["content-security-policy"] ?? "";
          diagnostics.push({ url: redact(url.href), status: response.status(),
            csp: response.headers()["content-security-policy"], referrerPolicy: response.headers()["referrer-policy"] });
          if (url.pathname.startsWith("/__reader/api/")) pending.push(response.text().then((body) => {
            diagnostics.push({ h5: url.pathname, status: response.status(), body: redact(body) });
          }, (error) => { diagnostics.push({ h5: url.pathname, error: String(error) }); }));
        });
        await page.addInitScript(() => addEventListener("securitypolicyviolation", (event) => {
          console.error("CSP", event.effectiveDirective, event.blockedURI);
        }));
        let started = Date.now();
        try {
          expect((await page.goto(`https://${host}/`))?.status()).toBe(200);
          expect(new URL(page.url()).host).toBe("app.example.test");
          started = Date.now();
          await expectUi(page.locator('html[data-st-theme="sent-tech"]')).toHaveCount(1);
          const approvalButton = page.getByRole("button", { name: "Autoriser et ouvrir" });
          expect(await approvalButton.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
          await page.keyboard.press("Tab");
          await expectUi(approvalButton).toBeFocused();
          expect(await approvalButton.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe("none");
          await page.getByRole("button", { name: "Autoriser et ouvrir" }).click();
          await page.waitForFunction((matched) => document.body.dataset.matched === String(matched), count, { timeout: 1500 });
          const elapsedMs = Date.now() - started;
          await Promise.all(pending);
          console.log(JSON.stringify({ readerMatched: count, elapsedMs, diagnostics }));
          expect(await page.locator("body").getAttribute("data-cookies")).toBe("");
          expect(await page.locator("body").getAttribute("data-inline-ready")).toBe("1");
          expect(await page.locator("body").getAttribute("data-dynamic-ready")).toBe("1");
          expect(await page.locator("body").getAttribute("data-version")).toBe(version);
          expect(await page.locator("script[data-label]").getAttribute("data-label")).toBe("a>b");
          const inlineHash = await page.locator("script[data-label]").evaluate(async (script) => {
            const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script.textContent ?? ""));
            return btoa(String.fromCharCode(...new Uint8Array(hash)));
          });
          expect(htmlCsp).toContain(`'sha256-${inlineHash}'`);
          expect(await page.locator("body").evaluate((body) => getComputedStyle(body).color)).toBe("rgb(17, 34, 51)");
          expect(page.url()).not.toContain("grant=");
          const navigation = new URL("/index.html", page.url());
          navigation.searchParams.set("workspaceId", f.data.workspaceId);
          navigation.searchParams.set("citySlug", "synthetic-city");
          const h5 = page.waitForResponse((response) => new URL(response.url()).pathname === "/__reader/api/baskets.search.v1");
          const navigationStarted = Date.now();
          expect((await page.goto(navigation.href))?.status()).toBe(200);
          await page.waitForFunction((matched) => document.body.dataset.matched === String(matched), count, { timeout: 1500 });
          const result = await h5;
          expect(result.status()).toBe(200);
          expect((await result.json()).counts.matched).toBe(count);
          expect(new URL(result.url()).searchParams.get("workspaceId")).toBe(f.data.workspaceId);
          expect(new URL(result.url()).searchParams.get("citySlug")).toBe("synthetic-city");
          expect(new URL(page.url()).searchParams.get("workspaceId")).toBe(f.data.workspaceId);
          expect(new URL(page.url()).searchParams.get("citySlug")).toBe("synthetic-city");
          expect(page.url()).not.toContain("grant=");
          await Promise.all(pending);
          console.log(JSON.stringify({ readerMatched: count, navigation: true,
            elapsedMs: Date.now() - navigationStarted, diagnostics }));
          expect(await page.evaluate(async () => (await fetch("/api/v1/workspaces")).status)).toBe(401);
          expect(await page.evaluate(async () => (await fetch("/sw.js")).status)).toBe(404);
          expect(statuses).toMatchObject({ "/": 200, "/main.js": 200, "/style.css": 200,
            "/baskets.js": 200, "/theme.css": 200, "/dynamic.js": 200,
            "/__reader/api/baskets.search.v1": 200 });
          expect(requests.filter((request) => request.method === "POST"))
            .toEqual([expect.objectContaining({ host: "app.example.test", origin: "https://app.example.test" })]);
          for (const request of requests) {
            if (request.host.endsWith(".pages.example.test")) expect(request.cookie).not.toContain("radar_session");
            if (request.host === "app.example.test" && request.path.startsWith("/api/v1/artifacts/reader/design/")) {
              expect(request.cacheControl).toContain("immutable");
            } else expect(request.cacheControl).toBe("private, no-store");
          }
          expect(errors).toEqual([]);
        } catch (error) {
          await Promise.allSettled(pending);
          console.error(JSON.stringify({ elapsedMs: Date.now() - started, url: redact(page.url()),
            body: redact(await page.locator("body").innerText()), errors: errors.map(redact), diagnostics,
            requests: requests.map(({ cookie, ...request }) => ({ ...request,
              appCookie: cookie.includes("radar_session="), readerCookie: cookie.includes("__Host-preview-session=") })) }, null, 2));
          throw error;
        } finally { await context.close(); }
      }
    } finally {
      try { await browser?.close(); } finally { await server.close(); }
    }
  });
});
