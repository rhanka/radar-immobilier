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
test.use({ actionTimeout: 1800 });

async function openPerimeter(page: Page, baseURL: string): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-03-31T16:00:00Z"));
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
    const total = 6 * multiplier + 3;
    const stages = { avis_motion: 6 * multiplier, adoption: 3, projet_reglement: 0,
      consultation_publique: 0, second_projet: 0, entree_vigueur: 0, inconnu: 0 };
    return route.fulfill({ json: { ok: true, cities: ["delson", "candiac"].map((citySlug) => ({
      citySlug, signalCount: total, subsetCounts: {},
      vivierV2Counts: {
        total, qualified: total, residentialUnknown: 0,
        excludedByReason: { non_residentiel_franc: 0, piia_non_pertinent: 0, hors_zonage: 0, derogation_hors_sujet: 0 },
        stageCounts: stages, stageCountsResEligible: stages,
        stageCountsHorsZonage: {}, stageCountsResEligibleHorsZonage: {},
      },
      // Visible cubes exclude archives. Only the class dimension includes them.
      filtreCube: { "11100": 6 * multiplier, "11000": 3 },
      filtreCubesByClassement: Object.fromEntries(classes.map((classe, index) => [classe,
        classe === "ecarte" ? (citySlug === "delson" ? { "11100": multiplier, "11000": 1 } : {})
          : { "11100": (index + 1) * multiplier, "11000": 1 }])),
    })), totalCount: 2 * total } });
  });
  const signals = classes.slice(0, 3).flatMap((classe, index) =>
    Array.from({ length: index + 2 }, (_, i) => ({
      id: `${classe}-${i}`, type: "Signal", label: `Residential zoning ${classe} ${i}`, citySlug: "delson",
      sourceRef: null, props: { refs: [{ publishedAt: "2026-03-30" }], properties: { zone_ref: "H-01" } },
      classification: { zonage: { valeur: "oui", source: "test", confiance: 1 },
        residentiel: { valeur: "oui", source: "test", confiance: 1 }, effet_densifiant: "inconnu",
        instrument: "rezonage", etape: i === index + 1 ? "adoption" : "avis_motion",
        etapes_historique: [i === index + 1 ? "adoption" : "avis_motion"],
        exclusion_reason: null, provenance: { extrait: "" }, confiance: 1 },
    })));
  await page.route("**/signal-facets/coherent-city**", (route) => route.fulfill({ json: {
    ok: true, token: "qa-revision", signals, legacyProjection: null,
    selection: signals.filter((node) => !node.id.startsWith("non_classe")).map((node) => ({
      target: { citySlug: "delson", type: node.type, id: node.id }, facet: "selection",
      basket: node.id.startsWith("pertinent") ? "pertinent" : "a_surveiller", state: "active", reasonCode: null,
    })),
    heads: [{ target: { citySlug: "delson", type: "Signal", id: "archived" },
      effectiveDiscarded: true, workspace: null, personal: { id: "archive-head", state: "active", reasonCode: "N-NON-RES" } }],
    counts: { total: 11, hidden: 2, visible: 9, selected: 5 },
  } }));
  await page.route("**/api/geo/delson/zones**", (route) => route.fulfill({ json: {
    ok: true, citySlug: "delson", source: "official", resolutionStatus: "official", geometryStatus: "official",
    zoneCount: 1, warnings: [], featureCollection: { type: "FeatureCollection", features: [{
      type: "Feature", properties: { code: "H-01", citySlug: "delson", kind: "H", lotCount: 0, lots: [] },
      geometry: { type: "Polygon", coordinates: [[[-73.555, 45.345], [-73.543, 45.345],
        [-73.543, 45.353], [-73.555, 45.353], [-73.555, 45.345]]] },
    }] },
  } }));
  await page.route("**/api/geo/collections/qc-zonage-delson/items**", (route) => route.fulfill({ status: 404, json: {} }));
  await page.goto(`${baseURL}/geo/region/quebec?mode=signal&filter.period=7d&filter.zonage=1&filter.residentiel=1&filter.precoce=1&filter.excludePiia=1&filter.excludeDerogations=1`);
  await expect(page.locator("button.rail-city-row")).toHaveCount(2);
}

test("should select every period preset with real mouse events", async ({ page, baseURL }) => {
  await openPerimeter(page, baseURL!);
  for (const [token, label, from] of [
    ["1mo", "Dernier mois", "2026-02-28"], ["3mo", "3 derniers mois", "2025-12-31"],
    ["6mo", "6 derniers mois", "2025-09-30"], ["12mo", "12 derniers mois", "2025-03-31"],
    ["all", "Illimité", null], ["7d", "Dernière semaine", "2026-03-24"],
  ]) {
    await page.getByRole("button", { name: /^Période des signaux/ }).click();
    const option = page.getByRole("option", { name: label, exact: true });
    await expect(option).toBeEnabled();
    expect(await option.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    const request = page.waitForRequest((request) => request.url().includes("/signal-facets/by-city"));
    await option.click();
    const params = new URL((await request).url()).searchParams;
    expect(params.get("dateFrom")).toBe(from);
    expect(params.get("dateTo")).toBe(from ? "2026-03-31" : null);
    await expect(page.getByRole("button", { name: `Période des signaux ${label}`, exact: true })).toBeVisible({ timeout: 1800 });
    if (token === "all") await expect(page).not.toHaveURL(/filter.period=/, { timeout: 1800 });
    else await expect(page).toHaveURL(new RegExp(`filter.period=${token}(?:&|$)`), { timeout: 1800 });
  }
});

test("should retain the discarded signal in the selected city and zone", async ({ page, baseURL }) => {
  await openPerimeter(page, baseURL!);
  const badge = page.getByTestId("classement-filter-panel").locator(".classement-row").nth(3).locator(".st-badge");
  const assertDiscarded = async (count: string) => {
    await page.getByTestId("classement-filter-trigger").click();
    await expect(badge).toHaveText(count);
    await page.getByTestId("classement-filter-trigger").click();
  };
  await assertDiscarded("1");
  const detail = page.waitForResponse((response) => response.url().includes("/coherent-city"));
  await page.locator("button.rail-city-row", { hasText: "Delson" }).click();
  await detail;
  await expect(page.getByRole("button", { name: "Ville", exact: true })).toHaveAttribute("aria-pressed", "true");
  await assertDiscarded("1");
  await page.getByTestId("zones-bucket-head").click();
  await page.locator(".sel-entity-head", { hasText: "H-01" }).click();
  await expect(page.getByRole("button", { name: "Zone", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/geo\/zone\/delson\/H-01/);
  await assertDiscarded("1");
  await page.getByTestId("filtre-trigger").click();
  await page.getByRole("checkbox", { name: "Précoce", exact: true }).uncheck();
  await page.getByTestId("filtre-trigger").click();
  await assertDiscarded("2");
  await page.getByRole("button", { name: /^Période des signaux/ }).click();
  await page.getByRole("option", { name: "Illimité", exact: true }).click();
  await assertDiscarded("3");
});

test("should count relevance across cities without selection and ignore its own facet", async ({ page, baseURL }) => {
  await openPerimeter(page, baseURL!);
  await page.getByTestId("classement-filter-trigger").click();
  const rows = page.getByTestId("classement-filter-panel").locator(".classement-row");
  for (const [index, count] of [2, 4, 6, 1].entries()) {
    await expect(rows.nth(index).locator(".st-badge")).toHaveText(String(count), { timeout: 1800 });
  }
  await page.getByRole("checkbox", { name: "Pertinent", exact: true }).uncheck();
  await expect(rows.nth(0).locator(".st-badge")).toHaveText("2");
  await page.getByTestId("classement-filter-trigger").click();
  await page.getByTestId("filtre-trigger").click();
  await page.getByRole("checkbox", { name: "Précoce", exact: true }).uncheck();
  await page.getByTestId("filtre-trigger").click();
  await page.getByTestId("classement-filter-trigger").click();
  for (const [index, count] of [4, 6, 8, 2].entries()) {
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

test("should keep Filtre at 12 when checking archives then selecting a city and zone", async ({ page, baseURL }) => {
  await openPerimeter(page, baseURL!);
  const assertFiltre = async () => {
    await page.getByTestId("filtre-trigger").click();
    const badges = page.getByTestId("filtre-panel").locator(".classement-row .st-badge");
    for (let index = 0; index < 3; index++) await expect.soft(badges.nth(index)).toHaveText("12");
    await page.getByTestId("filtre-trigger").click();
  };
  await assertFiltre();
  await page.getByTestId("classement-filter-trigger").click();
  await page.getByRole("checkbox", { name: "Écarté", exact: true }).check();
  await page.getByTestId("classement-filter-trigger").click();
  await assertFiltre();
  const detail = page.waitForResponse((response) => response.url().includes("/coherent-city"));
  await page.locator("button.rail-city-row", { hasText: "Delson" }).click();
  await detail;
  await expect(page.getByRole("button", { name: "Ville", exact: true })).toHaveAttribute("aria-pressed", "true");
  await assertFiltre();
  await page.getByTestId("zones-bucket-head").click();
  await page.locator(".sel-entity-head", { hasText: "H-01" }).click();
  await expect(page.getByRole("button", { name: "Zone", exact: true })).toHaveAttribute("aria-pressed", "true");
  await assertFiltre();
});

test("should show no archived cards when only Écarté is checked", async ({ page, baseURL }) => {
  await openPerimeter(page, baseURL!);
  await page.locator("button.rail-city-row", { hasText: "Delson" }).click();
  await page.getByTestId("signals-bucket-head").click();
  await expect(page.locator("[data-signal-node]")).toHaveCount(6);
  await page.getByTestId("classement-filter-trigger").click();
  await page.getByRole("checkbox", { name: "Écarté", exact: true }).check();
  await expect(page.locator("[data-signal-node]")).toHaveCount(6);
  for (const name of ["Pertinent", "À surveiller", "Non classé"]) {
    await page.getByRole("checkbox", { name, exact: true }).uncheck();
  }
  await expect(page.locator("[data-signal-node]")).toHaveCount(0);
});
