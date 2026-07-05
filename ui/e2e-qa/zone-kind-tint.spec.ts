import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Teinte des aplats de zone par TAXONOMIE GEO (bug Mont-Tremblant).
 *
 * Bug corrigé : geo sert des zones avec `kind` = code 2 lettres (ex. « CO ») et
 * `affectation` = libellé (ex. « Conservation ») ; la résolution de teinte ne
 * couvrait ni l'un ni l'autre → les zones tombaient en « AUTRE » → aplats
 * BLANCS invisibles (Mont-Tremblant : 156/585 zones Conservation, quasi tout
 * blanc).
 *
 * Comportement RENDU vérifié (pas de marqueurs de bundle) :
 *   1. zones mockées au profil Mont-Tremblant (kind=CO/affectation=Conservation,
 *      VP/Villégiature, CV-RF/Résidentielle, TO/Touristique) → la LÉGENDE
 *      zonage rend leurs familles (Conservation / récréation, Habitation…)
 *      avec des pastilles TEINTÉES, pas blanches ;
 *   2. une zone au kind vraiment inconnu → entrée « Type non déterminé » en
 *      GRIS CLAIR honnête (plus jamais blanc invisible).
 *
 * Aucun docker : vite preview + routes /api mockées (même pattern que
 * sources-coverage.spec.ts, zones posées dans le contour réel de Delson pour
 * que la caméra du drill les cadre).
 */

// ── Fixtures couverture (une seule ville suffit au drill) ────────────────────

const COVERAGE_CITY = {
  citySlug: "delson",
  cityName: "Delson",
  mrc: "Roussillon",
  priorityRank: 12,
  l1Raw: { state: "verified", freshness: "fresh", count: 9 },
  l2Graph: { state: "verified", freshness: "fresh", ontologyVersion: "2.2" },
  signals: { state: "verified", freshness: "fresh", count: 3, withCitation: 2, priority: 1 },
  l4Zonage: { state: "verified", freshness: "fresh", served: true, servedBy: "geo" },
  normes: { state: "absent", freshness: "unknown" },
  l5Lots: { state: "declared", freshness: "fresh", served: false, servedBy: null },
  tod: { state: "absent", freshness: "unknown", served: false, servedBy: null },
  worstStatus: "declared",
  nextMarginalGain: null,
};

const COVERAGE_RESPONSE = {
  generatedAt: "2026-07-01T00:00:00Z",
  totals: { cities: 1, l1Raw: 1, l2Graph: 1, signals: 1, l4Zonage: 1, l5Lots: 0 },
  cities: [COVERAGE_CITY],
};

// ── Zones au profil MONT-TREMBLANT (taxonomie geo réelle, mesure 2026-07) ────
// Rectangles DANS le contour réel de Delson (la caméra du drill les cadre).

function zone(
  code: string,
  kind: string | null,
  affectation: string | null,
  dx: number,
  dy: number,
) {
  const lon = -73.555 + dx;
  const lat = 45.345 + dy;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon, lat],
          [lon + 0.012, lat],
          [lon + 0.012, lat + 0.008],
          [lon, lat + 0.008],
          [lon, lat],
        ],
      ],
    },
    properties: {
      code,
      citySlug: "delson",
      geometryStatus: "official",
      confidence: 1,
      source: "official-zone",
      lotCount: 0,
      lots: [],
      ...(kind ? { kind } : {}),
      ...(affectation ? { affectation } : {}),
    },
  };
}

const TREMBLANT_PROFILE_ZONES = {
  ok: true,
  citySlug: "delson",
  source: "official",
  resolutionStatus: "official",
  geometryStatus: "official",
  zoneCount: 6,
  warnings: [],
  featureCollection: {
    type: "FeatureCollection",
    features: [
      // Le cas du bug : code kind 2 lettres + libellé d'affectation.
      zone("CO-939", "CO", "Conservation", 0, 0),
      zone("CO-940", "CO", "Conservation", 0.014, 0),
      zone("VP-101", "VP", "Villégiature paysagère", 0, 0.01),
      zone("CV-RF-1", "CV-RF", "CV - Résidentielle de faible densité", 0.014, 0.01),
      zone("TO-5", "TO", "Touristique", 0.028, 0),
      // Zone au kind VRAIMENT inconnu → « Type non déterminé » gris clair.
      zone("XY-9", "XY", null, 0.028, 0.01),
    ],
  },
};

async function mockZonesApi(page: Page): Promise<void> {
  await mockAuthenticated(page);
  // Enregistrées APRÈS le catch-all de mockAuthenticated → prioritaires.
  await page.route("**/api/source/coverage", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(COVERAGE_RESPONSE),
    }),
  );
  await page.route("**/api/source/coverage/*/grilles", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        citySlug: "delson",
        available: true,
        zoneCount: 6,
        zonesWithGrille: 0,
        zonesWithNormes: 0,
        covered: 0,
        state: "declared",
      }),
    }),
  );
  await page.route("**/api/geo/delson/zones**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TREMBLANT_PROFILE_ZONES),
    }),
  );
}

/** Pastille de légende d'une famille (span coloré de l'entrée). */
function legendChip(page: Page, label: string) {
  return page.locator("li", { hasText: label }).locator("span").first();
}

/** Couleur calculée d'une pastille (rgb normalisé par le navigateur). */
async function chipColor(page: Page, label: string): Promise<string> {
  return legendChip(page, label).evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
}

const WHITE = "rgb(255, 255, 255)";

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("Teinte de zone — taxonomie geo (kind 2 lettres + affectation)", () => {
  test("zones kind=CO/affectation=Conservation → TEINTÉES (légende, pas blanches) ; inconnu → gris clair", async ({
    page,
  }, testInfo) => {
    await mockZonesApi(page);
    await page.goto("/#/sources");
    await page
      .locator("button.rail-city-row", { hasText: "Delson" })
      .click();

    // ── La légende zonage rend les familles résolues depuis la taxonomie geo ──
    // CO/Conservation + TO/Touristique → une entrée fusionnée Conservation/récréation.
    await expect(page.locator("li", { hasText: "Conservation / récréation" })).toBeVisible();
    // VP/Villégiature paysagère + CV-RF/Résidentielle → Habitation.
    await expect(page.locator("li", { hasText: "Habitation" })).toBeVisible();
    // XY inconnu → dégradé honnête, jamais inventé.
    await expect(page.locator("li", { hasText: "Type non déterminé" })).toBeVisible();
    // AUCUNE famille fantôme (pas d'Industriel/Commercial dans la fixture).
    await expect(page.locator("li", { hasText: "Industriel" })).toHaveCount(0);

    // ── Pastilles TEINTÉES : plus jamais blanches ────────────────────────────
    const conservation = await chipColor(page, "Conservation / récréation");
    const habitation = await chipColor(page, "Habitation");
    const neutral = await chipColor(page, "Type non déterminé");
    expect(conservation).not.toBe(WHITE);
    expect(habitation).not.toBe(WHITE);
    // Les familles portent des teintes DISTINCTES (catégorielles DS).
    expect(conservation).not.toBe(habitation);
    // « Type non déterminé » = gris clair honnête (pas blanc invisible),
    // distinct des familles teintées.
    expect(neutral).not.toBe(WHITE);
    expect(neutral).not.toBe(conservation);
    expect(neutral).not.toBe(habitation);

    // ── Capture (maquette mockée au profil Mont-Tremblant) ───────────────────
    await page.waitForTimeout(3000); // laisse MapLibre peindre les aplats
    await page.screenshot({
      path: testInfo.outputPath("zone-kind-tint-mont-tremblant-profile.png"),
    });
  });
});
