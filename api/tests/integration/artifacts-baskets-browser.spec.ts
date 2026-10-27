import { chromium, type Browser } from "@playwright/test";
import { getRequestListener } from "@hono/node-server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { cookie, startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";
import { startBrowserHttps } from "./artifacts-baskets-browser.helpers.js";

// Explicit opt-in: the default CI API image has no browser installed.
describeDb.skipIf(process.env.ARTIFACTS_BROWSER_ACCEPTANCE !== "1")("published HTML/CSS/JS Chromium acceptance", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness("l3browser", ["author-alice"]); });
  afterAll(async () => { await h?.close(); });
  it("should execute the S3-published script and read each reader's PostgreSQL baskets under CSP", async () => {
    const f = await publishedBaskets(h);
    const app = f.runtime();
    let statuses: Record<string, number> = {};
    let requests: { host: string; cookie: string; cacheControl: string | null }[] = [];
    const server = await startBrowserHttps(getRequestListener(async (request) => {
      const url = new URL(request.url);
      const response = await app.fetch(request);
      statuses[url.pathname] = response.status;
      requests.push({ host: url.host, cookie: request.headers.get("cookie") ?? "",
        cacheControl: response.headers.get("cache-control") });
      return response;
    }));
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true, args: server.args });
      for (const [sub, count] of [[f.data.contributor.sub, 2], [f.data.moderator.sub, 1]] as const) {
        statuses = {};
        requests = [];
        // The certificate is ephemeral and restricted to this loopback fixture.
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const [name, value] = (await cookie(sub)).split("=") as [string, string];
        await context.addCookies([{ name, value, domain: "app.example.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await page.goto(`https://${f.host}/`);
          await page.getByRole("button", { name: "Autoriser et ouvrir" }).click();
          await page.waitForFunction((matched) => document.body.dataset.matched === String(matched), count, { timeout: 1500 });
          expect(await page.locator("body").getAttribute("data-cookies")).toBe("");
          expect(await page.locator("body").evaluate((body) => getComputedStyle(body).color)).toBe("rgb(17, 34, 51)");
          expect(page.url()).not.toContain("grant=");
          expect(await page.evaluate(async () => (await fetch("/api/v1/workspaces")).status)).toBe(401);
          expect(await page.evaluate(async () => (await fetch("/sw.js")).status)).toBe(404);
          expect(statuses).toMatchObject({ "/": 200, "/main.js": 200, "/style.css": 200,
            "/__reader/api/baskets.search.v1": 200 });
          for (const request of requests) {
            if (request.host === f.host) expect(request.cookie).not.toContain("radar_session");
            expect(request.cacheControl).toBe("private, no-store");
          }
          expect(errors).toEqual([]);
        } finally { await context.close(); }
      }
    } finally {
      try { await browser?.close(); } finally { await server.close(); }
    }
  });
});
