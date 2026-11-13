import { expect, test as base, type Page } from "@playwright/test";
import { dedicatedCdpPage } from "./url-filters-cdp.mjs";
import { EXCLUSION_LABELS, openExclusions } from "./signals-url-exclusions-fixture";

const test = process.env.QA_CDP_URL ? base.extend({
  page: async ({}, use) => {
    const connection = await dedicatedCdpPage(process.env.QA_CDP_URL);
    try {
      await connection.page.setViewportSize({ width: 1440, height: 1000 });
      await connection.page.bringToFront();
      await use(connection.page);
    } finally { await connection.close(); }
  },
}) : base;
test.use({ actionTimeout: 1800 });

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
    page.on("request", request => { if (request.url().includes("/signal-facets/by-city")) bulkRequests++; });
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

test("should share relevance and exclusions through reload, reopened links and history", async ({ page, baseURL }) => {
  await openExclusions(page, baseURL!);
  for (const name of ["Pertinent", "À surveiller", "Non classé", "Écarté"]) {
    await page.getByTestId("classement-filter-trigger").click();
    const before = page.url();
    const checkbox = page.getByRole("checkbox", { name, exact: true });
    const checked = !(await checkbox.isChecked());
    await checkbox.click();
    await expect(page).not.toHaveURL(before);
    const shared = page.url();
    const params = new URL(shared).searchParams;
    for (const key of new Set(params.keys())) expect(params.getAll(key)).toHaveLength(1);
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
