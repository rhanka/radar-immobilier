import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { DESIGN_KIT_ASSETS, MAP_KIT_ASSETS, designKitAssetUrl, mapKitAssetUrl } from "@radar/artifacts-host";
import { createDesignKitApp } from "../../src/artifacts/design-kit.js";
import { releaseCspForHtml } from "../../src/artifacts/release-files.js";
import { findFeatureAt } from "../../src/artifacts/design-assets/map-base.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "fixtures", "map-i4");

// Explicit opt-in, like the other artifact browser specs: the default CI
// API image has no browser installed.
describe.skipIf(process.env.ARTIFACTS_BROWSER_ACCEPTANCE !== "1")(
  "map-i4 qualification page under the real release CSP",
  () => {
    it("should render polygons, return clicks, zoom, fit and stay same-origin with zero CSP violations", async () => {
      const zonesRaw = readFileSync(join(fixtures, "zones-longueuil.geojson"), "utf8");
      const lotsRaw = readFileSync(join(fixtures, "lots-longueuil.geojson"), "utf8");
      const zones = JSON.parse(zonesRaw) as { features: { properties: Record<string, unknown> }[] };
      const lots = JSON.parse(lotsRaw) as { features: { properties: Record<string, unknown> }[] };

      const template = readFileSync(join(fixtures, "qualif-page.html"), "utf8");
      // A real artifact page links the two pinned kit stylesheets plus the
      // map kit files; all four are served same-origin by this server.
      const pageHtml = template
        .replaceAll("{{SENT_TECH_CSS}}", designKitAssetUrl(DESIGN_KIT_ASSETS[0]!))
        .replaceAll("{{COMPONENTS_CSS}}", designKitAssetUrl(DESIGN_KIT_ASSETS[1]!))
        .replaceAll("{{MAP_BASE_CSS}}", mapKitAssetUrl(MAP_KIT_ASSETS[1]!))
        .replaceAll("{{MAP_BASE_MJS}}", mapKitAssetUrl(MAP_KIT_ASSETS[0]!))
        .replaceAll("{{ZONES_URL}}", "/fixtures/zones.json")
        .replaceAll("{{LOTS_URL}}", "/fixtures/lots.json");
      const css = readFileSync(join(fixtures, "qualif-page.css"), "utf8");
      const appJs = readFileSync(join(fixtures, "qualif-app.js"), "utf8");

      const app = new Hono();
      app.route("/__artifacts/design", createDesignKitApp());
      app.get("/qualif-page.css", (c) => c.body(css, 200, { "Content-Type": "text/css; charset=utf-8" }));
      app.get("/qualif-app.js", (c) => c.body(appJs, 200, { "Content-Type": "text/javascript; charset=utf-8" }));
      app.get("/fixtures/zones.json", (c) => c.body(zonesRaw, 200, { "Content-Type": "application/json; charset=utf-8" }));
      app.get("/fixtures/lots.json", (c) => c.body(lotsRaw, 200, { "Content-Type": "application/json; charset=utf-8" }));
      app.get("/", (c) => {
        c.header("Content-Security-Policy", releaseCspForHtml(pageHtml));
        return c.html(pageHtml);
      });

      const seen: { host: string; path: string }[] = [];
      const listener = getRequestListener((request) => {
        const url = new URL(request.url);
        seen.push({ host: url.host, path: url.pathname });
        return app.fetch(request);
      });
      let server: Server | undefined;
      const browser = await chromium.launch({
        headless: true,
        // --disable-dev-shm-usage is a container necessity (64 MB /dev/shm),
        // unrelated to the artifact CSP under test.
        args: ["--no-sandbox", "--no-proxy-server", "--disable-dev-shm-usage"],
      });
      try {
        server = createServer(listener);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const { port } = server.address() as AddressInfo;
        const origin = `http://127.0.0.1:${port}`;
        const expectedHost = `127.0.0.1:${port}`;

        const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
        const errors: string[] = [];
        const violations: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.text().startsWith("CSP:")) violations.push(message.text());
        });
        await page.addInitScript(() => addEventListener("securitypolicyviolation", (event) => {
          console.error(`CSP: ${event.effectiveDirective} ${event.blockedURI}`);
        }));

        const response = await page.goto(`${origin}/`, { waitUntil: "networkidle" });
        expect(response?.status()).toBe(200);
        const csp = response?.headers()["content-security-policy"] ?? "";
        expect(csp).toContain("worker-src 'none'");
        expect(csp).toContain("connect-src 'self'");
        expect(csp).toContain("img-src 'self' data:");

        await page.waitForFunction(() => window.__mapQualif?.ready === true, null, { timeout: 10000 });
        expect(await page.locator("#fact-zones").textContent()).toBe("40");
        expect(await page.locator("#fact-lots").textContent()).toBe("80");
        expect(await page.locator('canvas[data-map-base="canvas"]').count()).toBe(1);

        const painted = await page.evaluate(() => {
          const canvas = document.querySelector('canvas[data-map-base="canvas"]') as HTMLCanvasElement;
          const context = canvas.getContext("2d")!;
          const { width, height } = canvas;
          const data = context.getImageData(0, 0, width, height).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4 * 37) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            if (r !== 238 || g !== 240 || b !== 234) count += 1;
          }
          return { samples: Math.floor(data.length / (4 * 37)), painted: count };
        });
        expect(painted.samples).toBeGreaterThan(100);
        expect(painted.painted).toBeGreaterThan(100);

        const view0 = await page.evaluate(() => ({ ...window.__mapQualif.map.getView() }));
        expect(view0.scale).toBeGreaterThan(0);
        await page.evaluate(() => window.__mapQualif.map.zoomIn());
        const view1 = await page.evaluate(() => ({ ...window.__mapQualif.map.getView() }));
        expect(view1.scale).toBeGreaterThan(view0.scale);
        await page.evaluate(() => window.__mapQualif.map.fitToBounds());
        const view2 = await page.evaluate(() => ({ ...window.__mapQualif.map.getView() }));
        expect(view2.scale).toBeCloseTo(view0.scale, 6);

        const box = await page.locator('canvas[data-map-base="canvas"]').boundingBox();
        expect(box).not.toBeNull();
        const centerX = box!.x + box!.width / 2;
        const centerY = box!.y + box!.height / 2;
        // Probe a small screen grid until a click lands on a feature: every
        // click travels the real event pipeline, the Node oracle below
        // checks the payload of the successful one.
        let click: {
          layer: string | null; index: number; lon: number; lat: number;
          zoneCode: string | null; lotId: string | number | null;
        } | null = null;
        for (const fx of [0.3, 0.4, 0.5, 0.6, 0.7]) {
          for (const fy of [0.3, 0.4, 0.5, 0.6, 0.7]) {
            await page.mouse.click(box!.x + box!.width * fx, box!.y + box!.height * fy);
            await page.waitForTimeout(150);
            const last = await page.evaluate(() =>
              window.__mapQualif.lastClick === null ? null : { ...window.__mapQualif.lastClick });
            if (last !== null && last.layer !== null) {
              click = last;
              break;
            }
          }
          if (click !== null) break;
        }
        expect(click, "no probed point hit a feature").not.toBeNull();
        expect(["zones", "lots"]).toContain(click!.layer);
        expect(click!.lon).toBeGreaterThan(-74);
        expect(click!.lon).toBeLessThan(-73);
        const expected = findFeatureAt(
          { outlines: [], zones: zones.features, lots: lots.features },
          click!.lon,
          click!.lat,
        );
        expect(expected).not.toBeNull();
        expect(expected!.layer).toBe(click!.layer);
        if (click!.layer === "lots") {
          const identity = (feature: { properties: Record<string, unknown> }) =>
            feature.properties["NO_LOT"] ?? feature.properties["noLot"];
          expect(identity(expected!.feature)).toBe(click!.lotId);
        } else {
          expect(expected!.feature.properties["zone_code"]).toBe(click!.zoneCode);
        }

        await page.mouse.move(centerX + 40, centerY + 40);
        await page.waitForFunction(() => window.__mapQualif?.lastHover !== null, null, { timeout: 5000 });
        const hover = await page.evaluate(() => ({ ...window.__mapQualif.lastHover }));
        expect(["zones", "lots", null]).toContain(hover.layer);

        const scaleBeforeWheel = (await page.evaluate(() => ({ ...window.__mapQualif.map.getView() }))).scale;
        await page.mouse.move(centerX, centerY);
        await page.mouse.wheel(0, -240);
        await page.waitForFunction(
          (before: number) => window.__mapQualif.map.getView().scale !== before,
          scaleBeforeWheel,
          { timeout: 5000 },
        );

        for (const entry of seen) {
          expect(entry.host, entry.path).toBe(expectedHost);
        }
        const paths = seen.map((entry) => entry.path);
        expect(paths).toContain("/");
        expect(paths).toContain("/qualif-app.js");
        expect(paths).toContain("/fixtures/zones.json");
        expect(paths).toContain("/fixtures/lots.json");
        expect(paths).toContain(mapKitAssetUrl(MAP_KIT_ASSETS[0]!));
        expect(paths).toContain(mapKitAssetUrl(MAP_KIT_ASSETS[1]!));
        expect(paths).toContain(designKitAssetUrl(DESIGN_KIT_ASSETS[0]!));
        expect(paths).toContain(designKitAssetUrl(DESIGN_KIT_ASSETS[1]!));
        expect(errors).toEqual([]);
        expect(violations).toEqual([]);
      } finally {
        await browser.close();
        if (server?.listening) {
          await new Promise<void>((resolve, reject) => {
            server!.close((error) => (error ? reject(error) : resolve()));
            server!.closeAllConnections();
          });
        }
      }
    },
    60000,
  );
  },
);
