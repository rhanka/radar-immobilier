import { expect, test as base, type Page } from "@playwright/test";
import { dedicatedCdpPage } from "./url-filters-cdp.mjs";
import { EXCLUSION_LABELS, openExclusions } from "./signals-url-exclusions-fixture";
import { readFileSync } from "node:fs";

const test = process.env.QA_CDP_URL ? base.extend({
  page: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("The exclusion regression requires a baseURL");
    const connection = await dedicatedCdpPage(process.env.QA_CDP_URL);
    try {
      await connection.page.setViewportSize({ width: 1440, height: 1000 });
      await connection.page.bringToFront();
      await use(connection.page);
    } finally { await connection.close(); }
  },
}) : base;
test.use({ actionTimeout: 1800 });

for (const selected of [false, true]) {
  for (const [index, label] of EXCLUSION_LABELS.entries()) {
    test(`should remove ${index ? "derogation" : "PIIA"} cities from the rendered map ${selected ? "with" : "without"} selection`, async ({ page, baseURL }) => {
      await openExclusions(page, baseURL!, false);
      const boundaries = JSON.parse(readFileSync(new URL("../public/municipalities.geojson", import.meta.url), "utf8"));
      boundaries.features = boundaries.features.filter((feature: { properties: { citySlug: string } }) =>
        ["delson", "candiac"].includes(feature.properties.citySlug));
      await page.route("**/municipalities.geojson", route => route.fulfill({ json: boundaries }));
      const cube = { [index ? "11101" : "11110"]: 1 };
      await page.route("**/signal-facets/by-city**", route => route.fulfill({ json: {
        ok: true, totalCount: 2, cities: ["delson", "candiac"].map(citySlug => ({
          citySlug, signalCount: 1, subsetCounts: {}, filtreCube: cube,
          filtreCubesByClassement: { pertinent: cube, a_surveiller: {}, non_classe: {}, ecarte: {} },
        })),
      } }));
      await page.route("**/signal-facets/coherent-city**", route => route.fulfill({ json: {
        ok: true, token: "map-exclusion", heads: [], selection: [], signals: [{
          id: "excluded", type: "Signal", label: "Excluded case", citySlug: "delson",
          props: { refs: [{ publishedAt: "2026-03-30" }] }, sourceRef: null,
          classification: { zonage: { valeur: "oui" }, residentiel: { valeur: "oui" },
            instrument: index ? "derogation" : "piia", etape: "avis_motion", exclusion_reason: null },
        }], counts: { total: 1, hidden: 0, visible: 1, selected: 0 },
      } }));
      await page.goto(`${baseURL}/e2e-qa/harness/signals-relevance.html`);
      await expect.poll(() => page.evaluate(() => Boolean(
        (window as unknown as { relevanceMap: import("maplibre-gl").Map }).relevanceMap?.getLayer("cities-fill"),
      )), { timeout: 10000 }).toBe(true);
      await page.getByTestId("filtre-trigger").click();
      await page.getByRole("checkbox", { name: label, exact: true }).click();
      await page.getByTestId("filtre-trigger").click();
      await total(page, 2);
      if (selected) await page.locator("button.rail-city-row", { hasText: "Delson" }).click();
      await page.getByTestId("filtre-trigger").click();
      await page.getByRole("checkbox", { name: label, exact: true }).click();
      await expect(page.locator(".rail-count-strong").first()).toHaveText("0");
      await expect(page.locator("button.rail-city-row")).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => {
        const map = (window as unknown as { relevanceMap: import("maplibre-gl").Map }).relevanceMap;
        return { allowed: map.getFilter("cities-fill")?.[2],
          rendered: map.queryRenderedFeatures({ layers: ["cities-fill"] }).length };
      })).toEqual({ allowed: ["literal", []], rendered: 0 });
    });
  }
}

async function total(page: Page, expected: number) {
  await expect(page.locator(".rail-count-strong").first()).toHaveText(String(expected));
  for (const city of ["Delson", "Candiac"]) {
    await expect(page.locator("button.rail-city-row", { hasText: city }).locator(".st-badge")).toHaveText(String(expected / 2));
  }
}

for (const selected of [false, true]) {
  test(`should apply each exclusion exactly ${selected ? "with" : "without"} a selected city`, async ({ page, baseURL }, info) => {
    await openExclusions(page, baseURL!);
    await total(page, 8);
    if (selected) {
      await page.locator("button.rail-city-row", { hasText: "Delson" }).click();
      await page.getByTestId("signals-bucket-head").click();
      await expect(page.locator("[data-signal-node]")).toHaveCount(4);
    }
    await page.screenshot({ path: info.outputPath("before.png") });
    let bulkRequests = 0;
    page.on("request", request => { if (/\/signal-facets\/(by-city|coherent-city)/.test(request.url())) bulkRequests++; });
    for (const [index, label] of EXCLUSION_LABELS.entries()) {
      await page.getByTestId("filtre-trigger").click();
      const row = page.getByTestId("filtre-panel").locator(".classement-row", { hasText: label });
      await expect(row.locator(".st-badge")).toHaveText("2");
      console.log("before exclusion", label, page.url(), await page.locator(".rail-count-strong").first().innerText());
      await page.getByRole("checkbox", { name: label, exact: true }).click();
      await expect(row.locator(".st-badge")).toHaveText("2");
      await page.getByTestId("filtre-trigger").click();
      await total(page, 6 - index * 2);
      if (selected) {
        await expect(page.locator("[data-signal-node]")).toHaveCount(3 - index);
        await expect(page.locator("[data-signal-node]", { hasText: `Case ${index ? 3 : 1} ` })).toHaveCount(0);
        await expect(page.locator("[data-signal-node]", { hasText: "Case 2 piia" })).toBeVisible();
      }
      console.log("after exclusion", label, page.url(), await page.locator(".rail-count-strong").first().innerText());
      await page.screenshot({ path: info.outputPath(`excluded-${index}.png`) });
    }
    expect(bulkRequests, "exclusions must use the loaded cubes").toBe(0);
  });
}

test("should share relevance and exclusions through reload, reopened links and history", async ({ page, baseURL }, info) => {
  await openExclusions(page, baseURL!);
  for (const name of ["Pertinent", "À surveiller", "Non classé", "Écarté"]) {
    await page.getByTestId("classement-filter-trigger").click();
    const before = page.url();
    const checkbox = page.getByRole("checkbox", { name, exact: true });
    const checked = !(await checkbox.isChecked());
    console.log("before relevance", name, before);
    await page.screenshot({ path: info.outputPath(`relevance-${name}-before.png`) });
    await checkbox.click();
    await expect(page).not.toHaveURL(before);
    const shared = page.url();
    console.log("after relevance", name, shared);
    await page.screenshot({ path: info.outputPath(`relevance-${name}-after.png`) });
    const params = new URL(shared).searchParams;
    for (const key of new Set(params.keys())) expect(params.getAll(key)).toHaveLength(1);
    await page.getByTestId("classement-filter-trigger").click();
    await page.goBack();
    await page.getByTestId("classement-filter-trigger").click();
    await expect(page.getByRole("checkbox", { name, exact: true })).toBeChecked({ checked: !checked });
    await page.getByTestId("classement-filter-trigger").click();
    await page.goForward();
    await expect(page).toHaveURL(shared);
    await page.reload();
    await page.getByTestId("classement-filter-trigger").click();
    await expect(page.getByRole("checkbox", { name, exact: true })).toBeChecked({ checked });
    await page.goto(shared);
    await page.getByTestId("classement-filter-trigger").click();
    await expect(page.getByRole("checkbox", { name, exact: true })).toBeChecked({ checked });
    await page.getByTestId("classement-filter-trigger").click();
  }
  for (const label of EXCLUSION_LABELS) {
    await page.getByTestId("filtre-trigger").click();
    const before = page.url();
    await page.getByRole("checkbox", { name: label, exact: true }).click();
    await expect(page).not.toHaveURL(before);
    const shared = page.url();
    await page.reload();
    await page.getByTestId("filtre-trigger").click();
    await expect(page.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
    await page.goto(shared);
    await page.getByTestId("filtre-trigger").click();
    await expect(page.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
    await page.getByTestId("filtre-trigger").click();
    await page.goBack();
    await expect(page).toHaveURL(before);
    await page.getByTestId("filtre-trigger").click();
    await expect(page.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
    await page.getByTestId("filtre-trigger").click();
    await page.goForward();
    await expect(page).toHaveURL(shared);
  }
});

test("should preserve city and zone with combined axes, relevance and exclusions", async ({ page, baseURL }) => {
  await openExclusions(page, baseURL!);
  await page.locator("button.rail-city-row", { hasText: "Delson" }).click();
  await page.getByTestId("classement-filter-trigger").click();
  await page.getByRole("checkbox", { name: "Non classé", exact: true }).click();
  await page.getByTestId("classement-filter-trigger").click();
  await total(page, 4);
  await page.getByTestId("filtre-trigger").click();
  await page.getByRole("checkbox", { name: "Précoce", exact: true }).click();
  await page.getByRole("checkbox", { name: EXCLUSION_LABELS[0], exact: true }).click();
  await page.getByTestId("filtre-trigger").click();
  await total(page, 2);
  for (const zone of [false, true]) {
    if (zone) {
      await page.getByTestId("zones-bucket-head").click();
      await page.locator(".sel-entity-head", { hasText: "H-01" }).click();
    }
    const shared = page.url();
    expect(new URL(shared).pathname).toBe(zone ? "/geo/zone/delson/H-01" : "/geo/city/delson");
    for (const reopen of [false, true]) {
      if (reopen) await page.goto(shared);
      else await page.reload();
      await expect(page.getByRole("button", { name: zone ? "Zone" : "Ville", exact: true })).toHaveAttribute("aria-pressed", "true");
      await total(page, 2);
      await page.getByTestId("filtre-trigger").click();
      await expect(page.getByRole("checkbox", { name: "Précoce", exact: true })).not.toBeChecked();
      await expect(page.getByRole("checkbox", { name: EXCLUSION_LABELS[0], exact: true })).toBeChecked();
      await page.getByTestId("filtre-trigger").click();
      await page.getByTestId("classement-filter-trigger").click();
      await expect(page.getByRole("checkbox", { name: "Non classé", exact: true })).not.toBeChecked();
      await page.getByTestId("classement-filter-trigger").click();
    }
  }
});
