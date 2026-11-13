import { expect, test as base, type Page } from "@playwright/test";
import { dedicatedCdpPage } from "./url-filters-cdp.mjs";
import { aggregate, cities, detail } from "./signals-relevance-fixtures.js";

const cdpTest = base.extend<{ page: Page }>({
  page: async ({}, use) => {
    const connection = await dedicatedCdpPage("http://127.0.0.1:9333");
    try {
      await connection.page.setViewportSize({ width: 1440, height: 1000 });
      await use(connection.page);
    } finally { await connection.close(); }
  },
});
const test = process.env.SIGNALS_RELEVANCE_CDP === "1" ? cdpTest : base;

for (const selected of [false, true]) {
  test(`should filter the whole relevance perimeter ${selected ? "with" : "without"} a selected city`, async ({ page, baseURL }) => {
    page.on("pageerror", (error) => console.log(error.message));
    let aggregateReads = 0;
    let detailReads = 0;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/workspaces") return route.fulfill({ json: { ok: true, workspaces: [{
        workspace: { id: "11111111-1111-4111-8111-111111111111", slug: "fixture", label: "Fixture" },
        moderateArchive: false, manageMembers: false,
      }] } });
      if (url.pathname.endsWith("/by-city")) {
        aggregateReads++;
        return route.fulfill({ json: { ok: true, totalCount: 8, cities: cities.map(aggregate) } });
      }
      if (url.pathname.endsWith("/coherent-city")) {
        detailReads++;
        return route.fulfill({ json: detail(cities.find((city) => city.slug === url.searchParams.get("citySlug"))!) });
      }
      return route.fulfill({ json: { ok: false, absent: true, featureCollection: { type: "FeatureCollection", features: [] } } });
    });
    await page.clock.setFixedTime(new Date("2026-11-13T17:00:00Z"));
    await page.goto(new URL("/e2e-qa/harness/signals-relevance.html", baseURL).href);
    await page.getByRole("button", { name: /^Période des signaux/ }).click();
    await page.getByRole("option", { name: "12 derniers mois", exact: true }).click();
    const header = page.locator(".rail-global-count");
    await expect(header).toHaveText("8 signaux · 4 villes");
    if (selected) {
      await page.getByRole("button", { name: /Delson/ }).click();
      await page.getByTestId("signals-bucket-head").click();
      await expect(page.locator("[data-signal-node]")).toHaveCount(3);
    }
    const initialReads = [aggregateReads, detailReads];
    await page.getByTestId("classement-filter-trigger").click();
    const labels = ["Pertinent", "À surveiller", "Non classé"];
    const totals = [3, 2, 3];
    const pureCities = ["Brossard", "Candiac", "Châteauguay"];
    for (let i = 0; i < labels.length; i++) {
      const row = page.getByTestId("classement-filter-panel").locator(".classement-row").filter({ hasText: labels[i] });
      await expect(row.locator(".st-badge")).toHaveText(String(totals[i]));
      await row.getByRole("checkbox").click();
      await expect(header).toHaveText(`${8 - totals[i]!} signaux · 3 villes`);
      await expect(page.getByRole("button", { name: new RegExp(pureCities[i]!) })).toHaveCount(0);
      if (selected) await expect(page.locator("[data-signal-node]")).toHaveCount(2);
      // Read the actual MapLibre paint and rendered features after native input.
      await expect.poll(() => page.evaluate((slug) => {
        const map = (window as unknown as { relevanceMap: import("maplibre-gl").Map }).relevanceMap;
        if (!map?.getLayer("cities-fill")) return null;
        return { color: map.getPaintProperty("cities-fill", "fill-color"),
          visible: map.queryRenderedFeatures({ layers: ["cities-fill"] }).some((f) => f.properties.citySlug === slug) };
      }, cities[i + 1]!.slug)).toMatchObject({ visible: false });
      await row.getByRole("checkbox").click();
      await expect(header).toHaveText("8 signaux · 4 villes");
    }
    await page.getByRole("checkbox", { name: "À surveiller", exact: true }).click();
    await page.getByRole("checkbox", { name: "Non classé", exact: true }).click();
    await expect(header).toHaveText("3 signaux · 2 villes");
    await expect(page.locator(".rail-city-row")).toHaveCount(2);
    if (selected) await expect(page.locator("[data-signal-node]")).toHaveCount(1);
    expect([aggregateReads, detailReads]).toEqual(initialReads);
  });
}
