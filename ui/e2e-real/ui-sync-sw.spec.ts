import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildDisabledWorkerSource } from "../src/lib/sw/disabled-worker-source.js";
import type {} from "./ui-sync-fixture.js";

let server: Server;
let origin: string;
let bytes: string;
let original: string;
const html = '<!doctype html><html lang="fr"><title>UI continuity qualification</title><body>'
  + '<input aria-label="Work in progress"><p id="status"></p><p id="invalidations">0</p>'
  + '<p id="beta"></p><p id="chat"></p><p id="lots"></p><p id="zones"></p>'
  + '<button id="toggle-beta">Beta</button><button id="toggle-chat">Chat</button>'
  + '<button id="toggle-lots">Lots</button><button id="toggle-zones">Zones</button>'
  + '<script src="/fixture.js"></script></body></html>';

test.beforeAll(async () => {
  original = await readFile(new URL("../public/immo-sw.js", import.meta.url), "utf8");
  bytes = original.replace("__IMMO_WORKER_BUILD_ID__", "N");
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("ui-sync-fixture.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", format: "iife", conditions: ["browser", "svelte"],
    define: { "import.meta.env.PROD": "true", __IMMO_CLIENT_BUILD_ID__: '"fixture"', __IMMO_SW_ENABLED__: "true" } });
  server = createServer((req, res) => {
    const path = new URL(req.url!, "http://fixture").pathname;
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'");
    if (path === "/immo-sw.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bytes); }
    else if (path === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].contents); }
    else if (path === "/incompatible.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end('navigator.serviceWorker.addEventListener("message",(e)=>{if(e.data.type==="HELLO")e.ports[0].postMessage({protocol:1,type:"HELLO",id:crypto.randomUUID(),correlationId:e.data.id,payload:{clientBuildId:"unsupported",tabId:crypto.randomUUID(),protocolVersion:2}})})');
    } else { res.setHeader("Content-Type", "text/html");
      res.end(path === "/unknown" ? "<!doctype html><title>Unknown client</title>Unknown client"
        : path === "/incompatible" ? '<!doctype html><title>Incompatible client</title><script src="/incompatible.js"></script>' : html); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { server?.closeAllConnections(); await new Promise<void>((resolve) => server?.close(() => resolve())); });

test("should preserve two tabs through registration, interruption, compatible update, rollback and kill", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin, serviceWorkers: "allow" });
  try {
    const a = await context.newPage(); const b = await context.newPage();
    await a.goto("/?build=N-1"); await expect(a.locator("#status")).toHaveText("ready", { timeout: 2000 });
    expect(await a.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
    await a.reload(); await expect(a.locator("#status")).toHaveText("ready", { timeout: 2000 });
    await b.goto("/?build=N"); await expect(b.locator("#status")).toHaveText("ready", { timeout: 2000 });
    await a.getByRole("textbox").fill("A draft"); await b.getByRole("textbox").fill("B draft");
    await a.getByRole("button", { name: "Beta", exact: true }).click();
    await expect(b.locator("#beta")).toHaveText("true", { timeout: 2000 });
    await Promise.all([a.getByRole("button", { name: "Lots", exact: true }).click(), b.getByRole("button", { name: "Zones", exact: true }).click()]);
    for (const page of [a, b]) {
      await expect(page.locator("#lots")).toHaveText("true", { timeout: 2000 });
      await expect(page.locator("#zones")).toHaveText("false", { timeout: 2000 });
    }
    await a.evaluate(() => window.continuity.client.notifyInvalidation({ scope: "context", citySlug: "valleyfield" }));
    await expect(b.locator("#invalidations")).toHaveText("1", { timeout: 2000 });
    const cdp = await context.newCDPSession(a);
    await cdp.send("ServiceWorker.enable"); await cdp.send("ServiceWorker.stopAllWorkers");
    expect((await a.evaluate(() => window.continuity.client.ping())).workerBuildId).toBe("N");
    await b.evaluate(() => window.continuity.client.ping());
    bytes = original.replace("__IMMO_WORKER_BUILD_ID__", "N+1");
    await a.evaluate(() => window.continuity.client.checkForUpdate());
    await expect(a.locator("#status")).toHaveText("waiting", { timeout: 2000 });
    const unknown = await context.newPage(); await unknown.goto("/unknown");
    expect((await a.evaluate(() => window.continuity.client.requestCompatibleActivation())).ok).toBe(false);
    await unknown.close();
    const incompatible = await context.newPage(); await incompatible.goto("/incompatible");
    expect((await a.evaluate(() => window.continuity.client.requestCompatibleActivation())).ok).toBe(false);
    await incompatible.close();
    expect(await a.evaluate(() => window.continuity.client.requestCompatibleActivation())).toEqual({ ok: true });
    expect((await b.evaluate(() => window.continuity.client.ping())).workerBuildId).toBe("N+1");
    await expect(b.getByRole("textbox")).toHaveValue("B draft");
    await a.reload(); await expect(b.getByRole("textbox")).toHaveValue("B draft");
    bytes = original.replace("__IMMO_WORKER_BUILD_ID__", "N");
    await a.evaluate(() => window.continuity.client.checkForUpdate());
    await expect(a.locator("#status")).toHaveText("waiting", { timeout: 2000 });
    expect((await a.evaluate(() => window.continuity.client.requestCompatibleActivation())).ok).toBe(true);
    expect((await b.evaluate(() => window.continuity.client.ping())).workerBuildId).toBe("N");
    expect(await a.evaluate(() => caches.keys())).toEqual([]);
    bytes = buildDisabledWorkerSource("kill");
    await a.evaluate(() => window.continuity.client.checkForUpdate());
    await expect(b.locator("#status")).toHaveText("disabled", { timeout: 2000 });
    await expect.poll(() => a.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { timeout: 2000 }).toBe(0);
    await expect(b.getByRole("textbox")).toHaveValue("B draft");
    const disabled = await context.newPage(); await disabled.goto("/?enabled=false");
    await expect(disabled.locator("#status")).toHaveText("disabled", { timeout: 2000 });
    await disabled.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(b.locator("#chat")).toHaveText("floating", { timeout: 2000 });
  } finally { await context.close(); }
});

test("should sync actual Svelte preferences and offer partial contexts without moving another tab", async ({ page, context }) => {
  await page.goto("/#/sources?filter.period=all&filter.citySearch=private&filter.showDiscarded=1");
  const other = await context.newPage(); await other.goto("/#/rapport");
  await expect(page.getByRole("link", { name: "Sources", exact: true })).toBeVisible();
  await page.keyboard.press("Control+Shift+X");
  await expect(other.getByRole("link", { name: "Évaluation", exact: true })).toBeVisible({ timeout: 2000 });
  expect(new URL(other.url()).hash).toBe("#/rapport");
  await page.goto("/#/sources?filter.period=all&filter.citySearch=private&filter.showDiscarded=1");
  await other.locator("summary").filter({ hasText: "Reprendre un contexte" }).click();
  await expect(other.getByText("Contexte partiel", { exact: false }).first()).toBeVisible({ timeout: 2000 });
  await other.getByRole("button", { name: "Reprendre ce contexte", exact: true }).first().click();
  await expect(other).toHaveURL(/#\/sources\?mode=signal&filter.period=all/, { timeout: 2000 });
  expect(other.url()).not.toMatch(/showDiscarded|citySearch|private/);
  await other.goBack(); await expect(other).toHaveURL(/#\/rapport$/);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  const response = await page.request.get("/immo-sw.js");
  expect(response.headers()["content-type"]).toMatch(/javascript/);
  expect(response.headers()["cache-control"]).toBe("no-cache");
  expect(response.headers()["content-security-policy"]).toBe("worker-src 'self'");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await page.request.get("/absent-worker.js")).status()).toBe(404);
});
