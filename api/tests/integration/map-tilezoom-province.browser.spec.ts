import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { DESIGN_KIT_ASSETS, MAP_KIT_ASSETS, designKitAssetUrl, mapKitAssetUrl } from "@radar/artifacts-host";
import { createDesignKitApp } from "../../src/artifacts/design-kit.js";
import { releaseCspForHtml } from "../../src/artifacts/release-files.js";

/** One transparent 1px PNG: the tile stub answers instantly, same-origin. */
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Province-scale outline plus a central lot that the click probe targets. */
const OUTLINE = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: { zone_code: "PROVINCE" },
    geometry: {
      type: "Polygon",
      coordinates: [[[-79.5, 45.0], [-57.0, 45.0], [-57.0, 62.5], [-79.5, 62.5], [-79.5, 45.0]]],
    },
  }],
};
const LOTS = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    properties: { NO_LOT: "PROV-1", zone_code: "C1" },
    geometry: {
      type: "Polygon",
      coordinates: [[[-72.0, 50.0], [-64.0, 50.0], [-64.0, 57.0], [-72.0, 57.0], [-72.0, 50.0]]],
    },
  }],
};

const PAGE_HTML = `<!doctype html>
<html lang="fr" data-st-theme="sent-tech">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>Carte — province (I-10)</title>
<link rel="stylesheet" href="{{SENT_TECH_CSS}}">
<link rel="stylesheet" href="{{COMPONENTS_CSS}}">
<link rel="stylesheet" href="{{MAP_BASE_CSS}}">
<link rel="stylesheet" href="/prov-page.css">
</head>
<body>
<main>
<h1>Carte — province</h1>
<p id="map-status" role="status">Chargement des donnees…</p>
<div class="map-base" id="map"></div>
</main>
<script type="module" src="/prov-app.js"></script>
</body>
</html>`;

const PAGE_CSS = `body{margin:0;}
.map-base{width:100vw;height:85vh;}
`;

const APP_JS = `const container = document.getElementById("map");
const status = document.getElementById("map-status");

async function boot() {
  const { createMap } = await import("{{MAP_BASE_MJS}}");
  const map = createMap(container, { basemapTemplate: "/tiles/{z}/{x}/{y}" });
  const [outlineResponse, lotsResponse] = await Promise.all([
    fetch("/fixtures/outline.json"),
    fetch("/fixtures/lots.json"),
  ]);
  map.setOutlines(await outlineResponse.json());
  map.setLots(await lotsResponse.json());
  map.setPaint({ lots: { fill: "#4c8c4a", stroke: "#2f2f2f", lineWidth: 1 } });
  map.fitToBounds();
  map.on("click", (event) => {
    window.__provTilezoom.lastClick = { layer: event.layer, index: event.index };
  });
  status.textContent = "Carte prete.";
  window.__provTilezoom.ready = true;
  window.__provTilezoom.map = map;
}

window.__provTilezoom = { ready: false, map: null, lastClick: null };
boot().catch((error) => {
  status.textContent = "Echec : " + (error instanceof Error ? error.message : String(error));
});`;

// Explicit opt-in, like the other artifact browser specs: the default CI
// API image has no browser installed.
describe.skipIf(process.env.ARTIFACTS_BROWSER_ACCEPTANCE !== "1")(
  "map-tilezoom province extent under the real release CSP",
  () => {
    it("should load a province page in under 3s with at most 96 tile requests and a live click handler", async () => {
      const pageHtml = PAGE_HTML
        .replaceAll("{{SENT_TECH_CSS}}", designKitAssetUrl(DESIGN_KIT_ASSETS[0]!))
        .replaceAll("{{COMPONENTS_CSS}}", designKitAssetUrl(DESIGN_KIT_ASSETS[1]!))
        .replaceAll("{{MAP_BASE_CSS}}", mapKitAssetUrl(MAP_KIT_ASSETS[1]!));
      const appJs = APP_JS.replaceAll("{{MAP_BASE_MJS}}", mapKitAssetUrl(MAP_KIT_ASSETS[0]!));

      const tileHits: string[] = [];
      const app = new Hono();
      app.route("/__artifacts/design", createDesignKitApp());
      app.get("/prov-page.css", (c) => c.body(PAGE_CSS, 200, { "Content-Type": "text/css; charset=utf-8" }));
      app.get("/prov-app.js", (c) => c.body(appJs, 200, { "Content-Type": "text/javascript; charset=utf-8" }));
      app.get("/fixtures/outline.json", (c) => c.body(JSON.stringify(OUTLINE), 200, { "Content-Type": "application/json; charset=utf-8" }));
      app.get("/fixtures/lots.json", (c) => c.body(JSON.stringify(LOTS), 200, { "Content-Type": "application/json; charset=utf-8" }));
      app.get("/tiles/:z/:x/:y", (c) => {
        tileHits.push(c.req.path);
        return c.body(Buffer.from(PIXEL_PNG_BASE64, "base64"), 200, { "Content-Type": "image/png" });
      });
      app.get("/", (c) => {
        c.header("Content-Security-Policy", releaseCspForHtml(pageHtml));
        return c.html(pageHtml);
      });

      const listener = getRequestListener((request) => app.fetch(request));
      let server: Server | undefined;
      const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--no-proxy-server", "--disable-dev-shm-usage"],
      });
      try {
        server = createServer(listener);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const { port } = server.address() as AddressInfo;
        const origin = `http://127.0.0.1:${port}`;

        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        const errors: string[] = [];
        const browserRequests: string[] = [];
        page.on("request", (request) => {
          browserRequests.push(request.url());
        });
        page.on("pageerror", (error) => errors.push(error.message));

        const startedAt = Date.now();
        const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
        expect(response?.status()).toBe(200);
        await page.waitForFunction(() => window.__provTilezoom?.ready === true, null, { timeout: 10000 });
        expect(Date.now() - startedAt).toBeLessThan(3000);
        expect(await page.locator('canvas[data-map-base="canvas"]').count()).toBe(1);

        // Let the async tile images settle, then audit the tile budget.
        await page.waitForTimeout(1500);
        expect(tileHits.length).toBeGreaterThan(0);
        expect(tileHits.length).toBeLessThanOrEqual(96);
        const zooms = tileHits.map((path) => Number(path.split("/")[2]));
        expect(zooms.every((z) => Number.isInteger(z))).toBe(true);
        expect(Math.max(...zooms)).toBeLessThanOrEqual(8);

        // The main thread stays responsive: a real click travels the map
        // event pipeline and fires the page handler.
        const box = await page.locator('canvas[data-map-base="canvas"]').boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.waitForFunction(() => window.__provTilezoom?.lastClick !== null, null, { timeout: 5000 });
        const click = await page.evaluate(() => ({ ...window.__provTilezoom.lastClick }));
        expect(click.layer).toBe("lots");

        for (const url of browserRequests) {
          expect(url.startsWith(origin), url).toBe(true);
        }
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        if (server?.listening) {
          await new Promise<void>((resolve, reject) => {
            server!.close((error) => (error ? reject(error) : resolve()));
            server!.closeAllConnections();
          });
        }
      }
    }, 60000);
  },
);
