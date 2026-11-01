import { chromium, expect as expectBrowser } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { getRequestListener } from "@hono/node-server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { cookie, startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";
import { startBrowserHttps } from "./artifacts-baskets-browser.helpers.js";
import { getAuthoringGuide } from "../../../packages/immo-mcp/src/registry/artifact-authoring-guide.js";
import { DESIGN_KIT_ASSETS, designKitAssetUrl } from "@radar/artifacts-host";
const expectUi = expectBrowser.configure({ timeout: 1500 });

describeDb.skipIf(process.env.ARTIFACTS_BROWSER_ACCEPTANCE !== "1")("MCP starter under the real reader CSP", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness("dsstarter", ["author-alice"]); });
  afterAll(async () => { await h?.close(); });
  it("should load official DS styles, read real baskets, recover a grant and show revoked access", async () => {
    const f = await publishedBaskets(h, { files: getAuthoringGuide().starter.files });
    const app = f.runtime();
    const paths: string[] = [];
    const server = await startBrowserHttps(getRequestListener(async (request) => {
      const url = new URL(request.url);
      if (url.host.endsWith(".pages.example.test")) paths.push(url.pathname);
      return app.fetch(request);
    }));
    const browser = await chromium.launch({ headless: true, args: server.args });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 375, height: 812 } });
      const [name, value] = (await cookie(f.data.contributor.sub)).split("=") as [string, string];
      await context.addCookies([{ name, value, domain: "app.example.test", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage();
      const screenshots = new URL("../../../tmp/mcp-ds-screenshots/", import.meta.url);
      await mkdir(screenshots, { recursive: true });
      const errors: string[] = [];
      const violations: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.text().startsWith("CSP:")) violations.push(message.text()); });
      await page.addInitScript(() => addEventListener("securitypolicyviolation", (event) => {
        console.error("CSP:", event.effectiveDirective, event.blockedURI);
      }));
      await page.goto(`https://${f.host}/`);
      const approve = page.getByRole("button", { name: "Autoriser et ouvrir" });
      await expectUi(page.locator('html[data-st-theme="sent-tech"]')).toHaveCount(1);
      await page.keyboard.press("Tab");
      await expectUi(approve).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: new URL("approval.png", screenshots).pathname, fullPage: true });
      await approve.click();
      await page.getByLabel("Espace de travail", { exact: true }).fill(f.data.workspaceId);
      await page.getByLabel("Ville", { exact: true }).fill("synthetic-city");
      await page.getByLabel("Panier", { exact: true }).selectOption("pertinent");
      const read = page.waitForResponse((response) => new URL(response.url()).pathname === "/__reader/api/baskets.search.v1");
      await page.getByRole("button", { name: "Lire les signaux" }).click();
      expect((await read).status()).toBe(200);
      await expectUi(page.locator("#items li")).toHaveCount(2);
      await expectUi(page.locator("#summary")).toHaveText("2 signaux — synthetic-city");
      expect(page.url()).not.toContain("grant=");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator("#load").evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
      for (const asset of DESIGN_KIT_ASSETS) expect(paths).toContain(designKitAssetUrl(asset));
      expect(paths.filter((path) => path.startsWith("/api/"))).toEqual([]);
      expect(paths.indexOf("/__reader/api/baskets.context.v1")).toBeLessThan(paths.indexOf("/__reader/api/baskets.search.v1"));
      await page.screenshot({ path: new URL("starter.png", screenshots).pathname, fullPage: true });

      // HTML navigation mints a fresh URL grant. Remove it before reader.js
      // starts to exercise actual recovery from the sealed session.
      await page.addInitScript(() => {
        const url = new URL(location.href);
        url.searchParams.delete("grant");
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      });
      const pinned = new URL(page.url()).origin;
      await page.goto(`${pinned}/index.html?workspaceId=${f.data.workspaceId}&citySlug=synthetic-city`);
      const renewed = page.waitForResponse((response) => new URL(response.url()).pathname === "/__reader/renew");
      await page.getByRole("button", { name: "Lire les signaux" }).click();
      expect((await renewed).status()).toBe(200);
      await expectUi(page.locator("#items li")).toHaveCount(2);
      await page.getByLabel("Panier", { exact: true }).selectOption("a_surveiller");
      await page.getByRole("button", { name: "Lire les signaux" }).click();
      await expectUi(page.getByRole("status")).toContainText("Aucun signal");
      await h.pool.query("DELETE FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2", [f.artifactId, f.data.contributor.sub]);
      await page.getByRole("button", { name: "Lire les signaux" }).click();
      await expectUi(page.getByRole("status")).toContainText("Votre accès a expiré");
      await expectUi(page.getByRole("link", { name: "Réouvrir la page" })).toHaveAttribute("href", "/__reader/start");
      expect(errors).toEqual([]);
      expect(violations).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  });
});
