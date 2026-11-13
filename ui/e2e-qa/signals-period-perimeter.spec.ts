import { expect, test as base, type Page } from "@playwright/test";
import { dedicatedCdpPage } from "./url-filters-cdp.mjs";
import { mockAuthenticated } from "./_helpers";

// An explicit CDP endpoint lets the same regression run in an existing browser
// using only a fresh, disposable tab. CI retains its normal Playwright browser.
const test = process.env.QA_CDP_URL ? base.extend({
  page: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("The perimeter regression requires a baseURL");
    const connection = await dedicatedCdpPage(process.env.QA_CDP_URL);
    try {
      await connection.page.setViewportSize({ width: 1440, height: 1000 });
      await connection.page.bringToFront();
      await use(connection.page);
    } finally { await connection.close(); }
  },
}) : base;

const classes = ["pertinent", "a_surveiller", "non_classe", "ecarte"] as const;
const stages = {
  avis_motion: 10, projet_reglement: 0, consultation_publique: 0,
  second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0,
};
test.use({ actionTimeout: 1800 });

async function openPerimeter(page: Page, baseURL: string): Promise<void> {
  await mockAuthenticated(page);
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: {
    authenticated: true, authDisabled: false,
    user: { sub: "qa-user", name: "QA", email: "qa@example.com", status: "approved", isAdmin: true },
  } }));
  await page.route("**/api/v1/workspaces", (route) => route.fulfill({ json: {
    ok: true, workspaces: [{ workspace: { id: "00000000-0000-4000-8000-000000000001", slug: "qa", label: "QA" },
      moderateArchive: false, manageMembers: false }],
  } }));
  await page.route("**/signal-facets/by-city**", (route) => {
    const multiplier = new URL(route.request().url()).searchParams.has("dateFrom") ? 1 : 2;
    return route.fulfill({ json: { ok: true, cities: ["delson", "candiac"].map((citySlug) => ({
      citySlug, signalCount: 10, subsetCounts: {},
      vivierV2Counts: {
        total: 10, qualified: 10, residentialUnknown: 0,
        excludedByReason: { non_residentiel_franc: 0, piia_non_pertinent: 0, hors_zonage: 0, derogation_hors_sujet: 0 },
        stageCounts: stages, stageCountsResEligible: stages,
        stageCountsHorsZonage: {}, stageCountsResEligibleHorsZonage: {},
      },
      filtreCube: { "11100": 6, "11000": 3 },
      filtreCubesByClassement: Object.fromEntries(classes.map((classe, index) => [classe, {
        "11100": (index + 1) * multiplier, "11000": 1,
      }])),
    })) } });
  });
  await page.goto(`${baseURL}/geo/region/quebec?mode=signal&filter.period=7d&filter.zonage=1&filter.residentiel=1&filter.precoce=1&filter.excludePiia=1&filter.excludeDerogations=1`);
  await expect(page.locator("button.rail-city-row")).toHaveCount(2);
}

test("should select every period preset with real mouse events", async ({ page, baseURL }) => {
  await openPerimeter(page, baseURL!);
  for (const [token, label] of [
    ["1mo", "Dernier mois"], ["3mo", "3 derniers mois"],
    ["6mo", "6 derniers mois"], ["12mo", "12 derniers mois"],
    ["all", "Illimité"], ["7d", "Dernière semaine"],
  ]) {
    await page.getByRole("button", { name: /^Période des signaux/ }).click();
    const option = page.getByRole("option", { name: label, exact: true });
    await expect(option).toBeEnabled();
    expect(await option.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await option.click();
    await expect(page.getByRole("button", { name: `Période des signaux ${label}`, exact: true })).toBeVisible({ timeout: 1800 });
    if (token === "all") await expect(page).not.toHaveURL(/filter.period=/, { timeout: 1800 });
    else await expect(page).toHaveURL(new RegExp(`filter.period=${token}(?:&|$)`), { timeout: 1800 });
  }
});

test("should count relevance across cities without selection and ignore its own facet", async ({ page, baseURL }) => {
  await openPerimeter(page, baseURL!);
  await page.getByTestId("classement-filter-trigger").click();
  const rows = page.getByTestId("classement-filter-panel").locator(".classement-row");
  for (const [index, count] of [2, 4, 6, 8].entries()) {
    await expect(rows.nth(index).locator(".st-badge")).toHaveText(String(count), { timeout: 1800 });
  }
  await page.getByRole("checkbox", { name: "Pertinent", exact: true }).uncheck();
  await expect(rows.nth(0).locator(".st-badge")).toHaveText("2");
  await page.getByTestId("classement-filter-trigger").click();
  await page.getByTestId("filtre-trigger").click();
  await page.getByRole("checkbox", { name: "Précoce", exact: true }).uncheck();
  await page.getByTestId("filtre-trigger").click();
  await page.getByTestId("classement-filter-trigger").click();
  for (const [index, count] of [4, 6, 8, 10].entries()) {
    await expect(rows.nth(index).locator(".st-badge")).toHaveText(String(count), { timeout: 1800 });
  }
  await page.getByTestId("classement-filter-trigger").click();
  await page.getByRole("button", { name: /^Période des signaux/ }).click();
  await page.getByRole("option", { name: "Illimité", exact: true }).click();
  await page.getByTestId("classement-filter-trigger").click();
  // The aggregate is fetched again with no date bounds; each early count doubles.
  await expect(rows.nth(0).locator(".st-badge")).toHaveText("6", { timeout: 1800 });
  await expect(rows.nth(2).locator(".st-badge")).toHaveText("14", { timeout: 1800 });
});
