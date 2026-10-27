import { chromium } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { cookie, startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";

// Explicit opt-in: the default CI API image has no browser installed.
describeDb.skipIf(process.env.ARTIFACTS_BROWSER_ACCEPTANCE !== "1")("published HTML/CSS/JS Chromium acceptance", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness("l3browser", ["author-alice"]); });
  afterAll(async () => { await h?.close(); });
  it("should execute the S3-published script and read each reader's PostgreSQL baskets under CSP", async () => {
    const f = await publishedBaskets(h);
    const app = f.runtime();
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      for (const [sub, count] of [[f.data.contributor.sub, 2], [f.data.moderator.sub, 1]] as const) {
        const context = await browser.newContext();
        const [name, value] = (await cookie(sub)).split("=") as [string, string];
        await context.addCookies([{ name, value, domain: "app.example.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const statuses: Record<string, number> = {};
        await page.route("https://**/*", async (route) => {
          const request = route.request();
          const requestHeaders = await request.allHeaders();
          const requestHost = new URL(request.url()).host;
          if (requestHost === f.host) expect(requestHeaders.cookie ?? "").not.toContain("radar_session");
          const response = await app.request(request.url(), { method: request.method(), body: request.postDataBuffer(),
            headers: { ...requestHeaders, host: requestHost } });
          statuses[new URL(request.url()).pathname] = response.status;
          expect(response.headers.get("cache-control")).toBe("private, no-store");
          const headers = Object.fromEntries(response.headers);
          if (response.headers.has("set-cookie")) headers["set-cookie"] = response.headers.getSetCookie().join("\n");
          await route.fulfill({ status: response.status, headers,
            body: Buffer.from(await response.arrayBuffer()) });
        });
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
          expect(errors).toEqual([]);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  });
});
