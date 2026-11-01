import { chromium, expect as expectBrowser } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getRequestListener } from "@hono/node-server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/scope-db-fixture.js";
import { cookie, startHarness, type Harness } from "./artifacts-h2.helpers.js";
import { publishedBaskets } from "./artifacts-baskets.helpers.js";
import { startBrowserHttps } from "./artifacts-baskets-browser.helpers.js";
import { startApprovalProxy } from "./artifacts-starter-browser.helpers.js";
import { getAuthoringGuide } from "../../../packages/immo-mcp/src/registry/artifact-authoring-guide.js";
import { DESIGN_KIT_ASSETS, designKitAssetUrl } from "@radar/artifacts-host";
import { approvalDesignAssetUrl } from "../../src/artifacts/reader-opening.js";
const expectUi = expectBrowser.configure({ timeout: 1500 });

describeDb.skipIf(process.env.ARTIFACTS_BROWSER_ACCEPTANCE !== "1")("MCP starter under the real reader CSP", () => {
  let h: Harness;
  beforeAll(async () => { h = await startHarness("dsstarter", ["author-alice"]); });
  afterAll(async () => { await h?.close(); });
  it("should load official DS styles, read real baskets, recover a grant and show revoked access", async () => {
    const f = await publishedBaskets(h, { files: getAuthoringGuide().starter.files });
    await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE workspace_id=$1 AND account_id=$2",
      [f.data.otherId, f.data.contributor.id]);
    const app = f.runtime();
    const requests: { url: URL; method: string }[] = [];
    const proxy = await startApprovalProxy(getRequestListener((request) => app.fetch(request)));
    const server = await startBrowserHttps(getRequestListener(async (request) => {
      const url = new URL(request.url);
      requests.push({ url, method: request.method });
      return url.host === "app.example.test" ? proxy.fetch(request) : app.fetch(request);
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
      const approvalCss = DESIGN_KIT_ASSETS.map((asset) => page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.host === "app.example.test" && url.pathname === approvalDesignAssetUrl(asset);
      }));
      await page.goto(`https://${f.host}/`);
      const approve = page.getByRole("button", { name: "Autoriser et ouvrir" });
      await expectUi(page.locator('html[data-st-theme="sent-tech"]')).toHaveCount(1);
      for (const [index, asset] of DESIGN_KIT_ASSETS.entries()) {
        await expectUi(page.locator(`link[href="${approvalDesignAssetUrl(asset)}"]`)).toHaveCount(1);
        const response = await approvalCss[index]!;
        expect(response.status()).toBe(200);
        expect(response.headers()["content-type"]).toContain("text/css");
        expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(asset.sha256Hex);
      }
      const oldPath = await proxy.fetch(new Request(`https://app.example.test${designKitAssetUrl(DESIGN_KIT_ASSETS[0]!)}`));
      expect(await oldPath.text()).toContain("SPA fallback");
      await expectUi(approve).toHaveCSS("background-color", /^(?!rgba\(0, 0, 0, 0\)|transparent)/);
      await page.keyboard.press("Tab");
      await expectUi(approve).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: new URL("approval.png", screenshots).pathname, fullPage: true });
      await approve.click();
      const workspace = page.getByRole("combobox", { name: "Espace de travail", exact: true });
      await expectUi(workspace).toHaveValue(f.data.workspaceId);
      await expectUi(page.getByRole("textbox", { name: "Espace de travail", exact: true })).toBeHidden();
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
      const paths = requests.filter(({ url }) => url.host.endsWith(".pages.example.test")).map(({ url }) => url.pathname);
      for (const asset of DESIGN_KIT_ASSETS) expect(paths).toContain(designKitAssetUrl(asset));
      expect(requests.filter(({ url }) => url.host === "app.example.test" && url.pathname.endsWith("/approve"))
        .map(({ method }) => method)).toEqual(["GET", "POST"]);
      expect(paths.indexOf("/__reader/api/workspaces.list.v1")).toBeLessThan(paths.indexOf("/__reader/api/baskets.context.v1"));
      expect(paths.indexOf("/__reader/api/baskets.context.v1")).toBeLessThan(paths.indexOf("/__reader/api/baskets.search.v1"));
      await page.screenshot({ path: new URL("starter.png", screenshots).pathname, fullPage: true });

      await page.clock.install({ time: new Date() });
      await page.clock.fastForward(31_000);
      const proactive = page.waitForResponse((response) => new URL(response.url()).pathname === "/__reader/renew");
      await page.getByRole("button", { name: "Lire les signaux" }).click();
      expect((await proactive).status()).toBe(200);
      await expectUi(page.locator("#items li")).toHaveCount(2);

      // HTML navigation mints a fresh URL grant. Remove it before reader.js
      // starts to exercise actual recovery from the sealed session.
      await page.addInitScript(() => {
        const url = new URL(location.href);
        url.searchParams.delete("grant");
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      });
      const pinned = new URL(page.url()).origin;
      const renewed = page.waitForResponse((response) => new URL(response.url()).pathname === "/__reader/renew");
      await page.goto(`${pinned}/index.html?citySlug=synthetic-city`);
      expect((await renewed).status()).toBe(200);
      await page.getByRole("button", { name: "Lire les signaux" }).click();
      await expectUi(page.locator("#items li")).toHaveCount(2);
      await page.getByLabel("Panier", { exact: true }).selectOption("a_surveiller");
      await page.getByRole("button", { name: "Lire les signaux" }).click();
      await expectUi(page.getByRole("status")).toContainText("Aucun signal");
      await f.data.pool.query("UPDATE workspace_memberships SET status='active',revoked_at=null WHERE workspace_id=$1 AND account_id=$2",
        [f.data.otherId, f.data.contributor.id]);
      await page.reload();
      await expectUi(workspace.locator("option")).toHaveCount(3);
      await expectUi(workspace).toHaveValue("");
      await workspace.selectOption(f.data.workspaceId);
      await f.data.pool.query("UPDATE workspace_memberships SET status='revoked',revoked_at=now() WHERE account_id=$1", [f.data.contributor.id]);
      await page.reload();
      const manualWorkspace = page.getByRole("textbox", { name: "Espace de travail", exact: true });
      await expectUi(manualWorkspace).toBeVisible();
      await expectUi(workspace).toBeHidden();
      await manualWorkspace.fill(f.data.workspaceId);
      await page.getByLabel("Ville", { exact: true }).fill("synthetic-city");
      await h.pool.query("DELETE FROM artifacts.artifact_access WHERE artifact_id=$1 AND principal_id=$2", [f.artifactId, f.data.contributor.sub]);
      await page.getByRole("button", { name: "Lire les signaux" }).click();
      await expectUi(page.getByRole("status")).toContainText("Votre accès a expiré");
      await expectUi(page.getByRole("link", { name: "Réouvrir la page" })).toHaveAttribute("href", "/__reader/start");
      expect(requests.filter(({ url }) => url.host.endsWith(".pages.example.test") && url.pathname.startsWith("/api/"))).toEqual([]);
      expect(errors).toEqual([]);
      expect(violations).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
      await proxy.close();
    }
  });
});
