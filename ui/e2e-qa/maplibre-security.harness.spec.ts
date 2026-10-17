import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const snapshot = JSON.parse(readFileSync(
  new URL("../src/lib/maps/fixtures/cadastre/delson.snapshot.json", import.meta.url), "utf8",
));

const hostile = 'Fixture © Provider <a href="javascript:window.__attributionProbe=1" onclick="window.__attributionProbe=2" onmouseover="window.__attributionProbe=3">probe</a><img src="invalid-fixture" onerror="window.__attributionProbe=4" onload="window.__attributionProbe=5">';
const lots = { type: "FeatureCollection", features: [{ ...snapshot.lots.features[0],
  properties: { noLot: "2181127", zoneCode: "H-12", citySlug: "delson" } }] };

for (const mode of ["native", "cadastre", "city", "provider", "geo", "engine"]) {
  test(`should render and select a real lot after worker initialization and remount (${mode})`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    const workers: string[] = [];
    const responses: { url: string; status: number; type: string }[] = [];
    const failures: string[] = [];
    const cancelledRasterRequests: string[] = [];
    let cameraExercised = false;
    const sourceRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("worker", (worker) => workers.push(worker.url()));
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      const reason = request.failure()?.errorText;
      const raster = (url.hostname === "tile.openstreetmap.org" && url.pathname.endsWith(".png"))
        || (url.hostname === "tile.googleapis.com" && url.pathname.startsWith("/v1/2dtiles/"));
      const receipt = `${url}: ${reason}`;
      if (cameraExercised && raster && reason === "net::ERR_ABORTED") {
        cancelledRasterRequests.push(receipt);
      } else failures.push(receipt);
    });
    page.on("response", (response) => responses.push({ url: response.url(), status: response.status(),
      type: response.headers()["content-type"] ?? "" }));
    await page.addInitScript(() => { (window as unknown as { __attributionProbe: number }).__attributionProbe = 0; });
    await page.route("**/security-lots.geojson", async (route) => {
      sourceRequests.push(route.request().url()); await route.fulfill({ json: lots });
    });
    await page.route("**/municipalities.geojson", (route) => route.fulfill({ json: { type: "FeatureCollection", features: [] } }));
    await page.route("**/basemap/2d/session", (route) => route.fulfill({ json: { key: "acceptance-fixture-public-key", mapType: "satellite" } }));
    await page.route("https://tile.googleapis.com/v1/createSession?*", (route) => route.fulfill({ json: {
      session: "acceptance-fixture", expiry: "4102444800", tileWidth: 256, tileHeight: 256, imageFormat: "png",
    } }));
    await page.route("https://tile.googleapis.com/tile/v1/viewport?*", (route) => route.fulfill({ json: { copyright: hostile } }));
    // Provider HTTP is a boundary fixture; raster bytes still come from the public OSM server.
    await page.route("https://tile.googleapis.com/v1/2dtiles/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace("/v1/2dtiles/", "");
      const response = await route.fetch({ url: `https://tile.openstreetmap.org/${path}.png` });
      await route.fulfill({ response });
    });
    try {
      await page.goto(`/e2e-qa/harness/maplibre-security.html?mode=${mode}`);
      const canvas = page.locator("canvas.maplibregl-canvas");
      await expect(canvas).toBeVisible();
      const frame = page.getByTestId("map-frame");
      let generationResponseStart = 0;
      for (let generation = 0; generation < 2; generation += 1) {
        await expect(canvas).toBeVisible();
        // A canvas can have MapLibre's fallback height while its clipping map host has collapsed.
        await expect.poll(() => frame.locator(".maplibregl-map").evaluate((host) => host.clientHeight)).toBeGreaterThan(0);
        if (mode === "native" || mode === "cadastre" || mode === "city" || mode === "provider") {
          // Cadastre installs its GeoJSON on map load; load waits for external raster responses.
          // Resolve that network prerequisite before the normal two-second interaction assertion.
          await expect.poll(() => responses.slice(generationResponseStart).some((response) => response.status === 200 &&
            (mode === "provider"
              ? response.url.startsWith("https://tile.googleapis.com/v1/2dtiles/")
              : response.url.startsWith("https://tile.openstreetmap.org/"))),
          { timeout: 10000, message: "A real public raster tile must complete before lot interaction" }).toBe(true);
        }
        if (mode === "native") {
          await expect.poll(() => page.evaluate(() => {
            const map = (window as unknown as { __securityMap: import("maplibre-gl").Map }).__securityMap;
            return map?.isSourceLoaded("lots") && map.queryRenderedFeatures({ layers: ["lots"] }).some((f) => f.properties.noLot === "2181127");
          })).toBe(true);
        }
        if (mode === "engine") {
          await expect.poll(() => page.evaluate(() => {
            const engine = (window as unknown as { __securityEngine: import("@sentropic/geo-map-engine").GeoMapHandle }).__securityEngine;
            return engine?.queryRenderedFeatures().some((feature) => feature.properties.noLot === "2181127");
          })).toBe(true);
        }
        // Actual pointer hit testing and selected lot detail prove processed GeoJSON, not just a canvas.
        await expect.poll(async () => {
          const box = await canvas.boundingBox();
          if (!box) return false;
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          if (mode === "cadastre") {
            const detail = page.getByTestId("lot-detail");
            return await detail.count() > 0 && (await detail.textContent())?.includes("2181127");
          }
          return (await page.getByTestId("selection").textContent()) === "2181127";
        }).toBe(true);
        if (mode === "native" || mode === "cadastre") {
          const credit = frame.locator(".maplibregl-ctrl-attrib-inner");
          await expect(credit).toContainText("OpenStreetMap");
          if (mode === "native") {
            await expect(credit).toContainText("Fixture © Provider");
            await expect(credit).toContainText("probe");
          }
          expect(await credit.evaluate((element) => [...element.querySelectorAll("*")].some((child) =>
            [...child.attributes].some((attribute) => attribute.name.startsWith("on"))
            || child.tagName === "SCRIPT"
            || (child instanceof HTMLAnchorElement && child.protocol === "javascript:"),
          ))).toBe(false);
        }
        if (mode === "provider") {
          const credit = page.getByTestId("map-attribution");
          await expect(credit).toContainText(hostile);
          expect(await credit.locator("img, script, [onerror], a[href^='javascript:']").count()).toBe(0);
        }
        expect(await page.evaluate(() => (window as unknown as { __attributionProbe: number }).__attributionProbe)).toBe(0);
        // Real pointer pan and wheel zoom exercise the map after selection.
        const box = await canvas.boundingBox();
        if (!box) throw new Error("Map canvas disappeared");
        const before = mode === "native" ? await page.evaluate(() => {
          const map = (window as unknown as { __securityMap: import("maplibre-gl").Map }).__securityMap;
          return { longitude: map.getCenter().lng, zoom: map.getZoom() };
        }) : null;
        cameraExercised = true;
        await page.mouse.move(box.x + 200, box.y + 180);
        await page.mouse.down(); await page.mouse.move(box.x + 250, box.y + 180, { steps: 5 }); await page.mouse.up();
        await page.mouse.wheel(0, -120);
        if (before) {
          await expect.poll(() => page.evaluate((prior) => {
            const map = (window as unknown as { __securityMap: import("maplibre-gl").Map }).__securityMap;
            return map.getCenter().lng !== prior.longitude && map.getZoom() > prior.zoom;
          }, before)).toBe(true);
        }
        if (generation === 0) {
          generationResponseStart = responses.length;
          await page.getByRole("button", { name: "Unmount and remount map" }).click();
          await expect(page.getByTestId("generation")).toHaveText("1");
        }
      }
      expect(workers.length, "Actual browser module worker must be created").toBeGreaterThan(0);
      const workerAssets = responses.filter((response) => /worker.*\.(js|mjs)(\?|$)/.test(response.url));
      expect(workerAssets.length, "Worker HTTP receipt must be retained").toBeGreaterThan(0);
      for (const asset of workerAssets) {
        expect(asset.status).toBe(200); expect(asset.type).toMatch(/^(application|text)\/javascript/);
      }
      if (mode === "native") expect(sourceRequests.length).toBeGreaterThanOrEqual(2);
      if (mode !== "provider" && mode !== "geo" && mode !== "engine") {
        await expect.poll(() => responses.some((response) => response.url.startsWith("https://tile.openstreetmap.org/") && response.status === 200),
          { timeout: 10000, message: "A real public OSM raster tile must complete" }).toBe(true);
      }
      expect(errors).toEqual([]); expect(failures).toEqual([]);
    } finally {
      const receipt = testInfo.outputPath("browser-receipt.json");
      writeFileSync(receipt, JSON.stringify({ mode, browser: page.context().browser()?.version(),
        workers, responses, sourceRequests, errors, failures, cancelledRasterRequests }, null, 2));
      await testInfo.attach("maplibre-browser-receipt", { path: receipt, contentType: "application/json" });
      await testInfo.attach("map-render", { body: await page.screenshot(), contentType: "image/png" });
    }
  });
}
