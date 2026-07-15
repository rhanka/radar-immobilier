import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Vue Sources/Couverture : MÊME mode d'interaction que Signaux.
 *
 * Comportement RENDU vérifié (pas de marqueurs de bundle) :
 *   1. Rail gauche = sélecteur RADIO MUTUELLEMENT EXCLUSIF à 3 portées
 *      (« Focus QA : 4 villes » / « Villes à signaux précoces » / « Toutes »)
 *      + liste plate de villes — « Toutes » par défaut (l'ancien toggle
 *      « Province (1104) / Focus 30 » de la carte a disparu). La portée focus
 *      = villes portant ≥ 1 signal PRIORITAIRE z∩m∩p (zonage ∩ multifamilial
 *      4+ ∩ précoce) — ni proximité, ni volume brut de signaux.
 *   2. Chaque portée change la LISTE de villes (et la coloration carte).
 *   3. Sélection d'une ville (rail) → drawer droit = scorecard de couverture
 *      (SourceScorecard : PV · Signaux · Zones · Règlements & normes · Lots · TOD +
 *      fraîcheur + prochaine étape) ET drill zones sur la carte (segmented
 *      Province / Ville / Zone du socle partagé).
 *   4. Segment « Zone » → sélection de zone (niveau Zone actif).
 *
 * Aucun docker : vite preview + routes /api mockées (fixtures ci-dessous).
 */

// ── Fixtures couverture ───────────────────────────────────────────────────────

type CoverageState = "verified" | "declared" | "absent";

function cell(state: CoverageState, extra: Record<string, unknown> = {}) {
  return {
    state,
    freshness: state === "absent" ? "unknown" : "fresh",
    ...extra,
  };
}

function geoCell(state: CoverageState) {
  return cell(state, {
    served: state === "verified",
    servedBy: state === "verified" ? "geo" : null,
  });
}

function coverageCity(
  citySlug: string,
  cityName: string,
  mrc: string,
  priorityRank: number | null,
  worstStatus: CoverageState,
  prioritySignals = 0,
) {
  return {
    citySlug,
    cityName,
    mrc,
    priorityRank,
    l1Raw: cell(worstStatus === "absent" ? "absent" : "verified", { count: 9 }),
    l2Graph: cell(worstStatus === "absent" ? "absent" : "verified", {
      ontologyVersion: worstStatus === "absent" ? null : "2.2",
    }),
    signals: cell(worstStatus === "absent" ? "absent" : "verified", {
      count: worstStatus === "absent" ? 0 : 3,
      withCitation: worstStatus === "absent" ? 0 : 2,
      priority: prioritySignals,
    }),
    l4Zonage: geoCell(worstStatus === "absent" ? "absent" : "verified"),
    normes: cell("absent"),
    l5Lots: geoCell(worstStatus),
    tod: geoCell("absent"),
    worstStatus,
    nextMarginalGain: null,
  };
}

// 10 villes. Portée « Villes à signaux précoces » = villes portant ≥ 1 signal
// PRIORITAIRE z∩m∩p (champ `signals.priority`) : la-prairie/candiac/rimouski
// (absent) ont 0 signal → HORS focus30 malgré un bon rang ; longueuil a des
// signaux (3) mais 0 prioritaire → HORS focus30 (le volume brut ne compte pas) ;
// sainte-sophie (rang 44, LOIN) porte 1 prioritaire → DANS focus30
// (bug Steve : plus de critère priorityRank ≤ 30, plus de top-N par volume).
const CITIES = [
  coverageCity("longueuil", "Longueuil", "Longueuil", 3, "verified", 0),
  coverageCity("la-prairie", "La Prairie", "Roussillon", 5, "absent", 0),
  // MRC fixture ≠ « Longueuil » pour que le sélecteur hasText "Longueuil"
  // (exclusion du focus) ne matche QUE la ville Longueuil elle-même.
  coverageCity("brossard", "Brossard", "Roussillon", 8, "declared", 1),
  coverageCity("delson", "Delson", "Roussillon", 12, "declared", 1),
  coverageCity("chateauguay", "Châteauguay", "Roussillon", 15, "declared", 1),
  coverageCity("sainte-catherine", "Sainte-Catherine", "Roussillon", 20, "verified", 1),
  coverageCity("saint-constant", "Saint-Constant", "Roussillon", 22, "declared", 1),
  coverageCity("candiac", "Candiac", "Roussillon", 25, "absent", 0),
  coverageCity("sainte-sophie", "Sainte-Sophie", "La Rivière-du-Nord", 44, "declared", 1),
  coverageCity("rimouski", "Rimouski", "Rimouski-Neigette", null, "absent", 0),
];

const COVERAGE_RESPONSE = {
  generatedAt: "2026-07-01T00:00:00Z",
  // 7 villes ont des signaux (les 3 « absent » — la-prairie/candiac/rimouski — 0).
  totals: { cities: 10, l1Raw: 8, l2Graph: 8, signals: 7, l4Zonage: 8, l5Lots: 3 },
  cities: CITIES,
};

// ── Fixture zones de Delson (drill) — rectangles DANS le contour réel ────────

function delsonZone(code: string, kind: string, dx: number, dy: number) {
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
      kind,
    },
  };
}

const DELSON_ZONES = {
  ok: true,
  citySlug: "delson",
  source: "official",
  resolutionStatus: "official",
  geometryStatus: "official",
  zoneCount: 3,
  warnings: [],
  featureCollection: {
    type: "FeatureCollection",
    features: [
      delsonZone("H-01", "habitation", 0, 0),
      delsonZone("C-02", "commerce", 0.014, 0.002),
      delsonZone("A-03", "agricole", 0.005, 0.01),
    ],
  },
};

const DELSON_GRILLES = {
  citySlug: "delson",
  available: true,
  zoneCount: 3,
  numberMatched: 3,
  complete: true,
  zonesWithGrille: 1,
  zonesWithReglement: 1,
  zonesWithLegacyNormes: 0,
  zonesWithNormativeValues: 2,
  covered: 2,
  state: "declared",
};

async function mockSourcesApi(page: Page): Promise<void> {
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
      body: JSON.stringify(DELSON_GRILLES),
    }),
  );
  await page.route("**/api/geo/delson/zones**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(DELSON_ZONES),
    }),
  );
}

function scopeRadios(page: Page) {
  return page.locator('input[type="radio"][name="sources-scope"]');
}

function cityRows(page: Page) {
  return page.locator("button.rail-city-row");
}

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("Sources/Couverture — mode d'interaction Signaux", () => {
  test.beforeEach(async ({ page }) => {
    await mockSourcesApi(page);
    await page.goto("/#/sources");
    await cityRows(page).first().waitFor({ state: "visible", timeout: 15_000 });
  });

  test("rail gauche : radio 3 portées EXCLUSIF (défaut « Toutes ») + liste plate", async ({
    page,
  }, testInfo) => {
    const radios = scopeRadios(page);
    await expect(radios).toHaveCount(3);
    // Libellés des 3 portées.
    await expect(page.getByText("Focus QA : 4 villes")).toBeVisible();
    await expect(page.getByText("Villes à signaux précoces")).toBeVisible();
    // Défaut : « Toutes » cochée SEULE.
    await expect(radios.nth(0)).not.toBeChecked();
    await expect(radios.nth(1)).not.toBeChecked();
    await expect(radios.nth(2)).toBeChecked();
    // Liste plate : les 10 villes de la couverture, badges tri-état.
    await expect(cityRows(page)).toHaveCount(10);
    await expect(cityRows(page).first()).toContainText("Longueuil");
    // L'ancien toggle carte « Province (1104) / Focus 30 » a DISPARU :
    // le segmented du socle porte le drill Province / Ville / Zone.
    await expect(page.getByRole("button", { name: "Province (1104)" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Focus 30" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Province", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ville", exact: true })).toBeVisible();

    // Laisse la carte se peindre pour la capture.
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: testInfo.outputPath("a-sources-rail-radio-3-portees.png"),
    });
  });

  test("chaque portée change la liste + la carte (radio exclusif)", async ({
    page,
  }, testInfo) => {
    const radios = scopeRadios(page);

    // (c1) Portée « Focus QA : 4 villes » → exactement les 4 villes de contrôle.
    await radios.nth(0).check();
    await expect(radios.nth(0)).toBeChecked();
    await expect(radios.nth(2)).not.toBeChecked();
    await expect(cityRows(page)).toHaveCount(4);
    await expect(cityRows(page).nth(0)).toContainText("Delson");
    await expect(cityRows(page).nth(1)).toContainText("Sainte-Catherine");
    await expect(cityRows(page).nth(2)).toContainText("Saint-Constant");
    await expect(cityRows(page).nth(3)).toContainText("Candiac");
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: testInfo.outputPath("c1-portee-focus-qa-4-villes.png"),
    });

    // (c2) Portée « Villes à signaux précoces » → villes portant ≥ 1 signal
    // PRIORITAIRE z∩m∩p. 6 villes de la fixture en portent un.
    await radios.nth(1).check();
    await expect(radios.nth(1)).toBeChecked();
    await expect(radios.nth(0)).not.toBeChecked();
    await expect(cityRows(page)).toHaveCount(6);
    // Bug Steve corrigé : Sainte-Sophie (rang 44, LOIN) est listée car elle
    // porte un signal prioritaire (l'ancien rang ≤ 30 l'excluait à tort).
    await expect(page.locator("button.rail-city-row", { hasText: "Sainte-Sophie" })).toHaveCount(1);
    // Villes proches SANS signal exclues (l'ancien rang ≤ 30 les gardait) :
    await expect(page.locator("button.rail-city-row", { hasText: "La Prairie" })).toHaveCount(0);
    await expect(page.locator("button.rail-city-row", { hasText: "Candiac" })).toHaveCount(0);
    // Le VOLUME ne suffit pas : Longueuil (3 signaux, 0 prioritaire) exclue.
    await expect(page.locator("button.rail-city-row", { hasText: "Longueuil" })).toHaveCount(0);
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: testInfo.outputPath("c2-portee-villes-signaux-precoces.png"),
    });

    // (c3) Retour « Toutes » → liste complète restaurée.
    await radios.nth(2).check();
    await expect(cityRows(page)).toHaveCount(10);
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: testInfo.outputPath("c3-portee-toutes.png"),
    });
  });

  test("sélection ville → drawer scorecard couverture + drill zones sur la carte", async ({
    page,
  }, testInfo) => {
    // Clic Delson dans le RAIL (même chemin que le clic carte).
    await page
      .locator("button.rail-city-row", { hasText: "Delson" })
      .click();

    // ── Drawer droit = scorecard de couverture (contenu type Sainte-Sophie) ──
    const scorecard = page.locator('[data-testid="source-scorecard"]');
    await expect(scorecard).toBeVisible();
    await expect(scorecard).toContainText("Delson");
    await expect(scorecard).toContainText("Roussillon");
    await expect(scorecard).toContainText("rang 12");
    await expect(scorecard).toContainText("Couverture : Partiel");
    for (const label of [
      "PV collectés",
      "Signaux extraits",
      "Zones servies",
      "Règlements & normes",
      "Lots (cadastre)",
      "Périmètres TOD",
    ]) {
      await expect(scorecard).toContainText(label);
    }
    // NOTE : le libellé exact du compte rend « 3 signalaux » (pluriel FR bogué
    // PRÉEXISTANT dans SourceScorecard, réutilisé tel quel) — on épingle la
    // partie stable de la preuve.
    await expect(scorecard).toContainText("2 avec citation vérifiable");
    await expect(scorecard).toContainText("fraîcheur");
    // Preuves règlementaires mesurées LAZY + prochaine étape.
    await expect(scorecard).toContainText("1/3 source règlementaire");
    await expect(scorecard).toContainText("2/3 valeurs normatives");
    await expect(scorecard).toContainText("1/3 grille PDF");
    await expect(scorecard).toContainText("Prochaine étape");

    // ── Drill : segment « Ville » actif, « Zone » ACTIVÉ (zones configurées) ──
    const villeSegment = page.getByRole("button", { name: "Ville", exact: true });
    await expect(villeSegment).toHaveAttribute("aria-pressed", "true");
    const zoneSegment = page.getByRole("button", { name: "Zone", exact: true });
    await expect(zoneSegment).toBeEnabled();

    // La carte vole vers Delson et peint les zones (fixture H-01/C-02/A-03).
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: testInfo.outputPath("b-delson-drawer-scorecard-zones.png"),
    });

    // ── Segment « Zone » → sélection de la 1re zone, niveau Zone actif ──────
    await zoneSegment.click();
    await expect(zoneSegment).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: testInfo.outputPath("b2-delson-zone-selectionnee.png"),
    });

    // ── Fermer la scorecard → retour Province (drawer placeholder) ──────────
    await scorecard.getByRole("button", { name: "Fermer" }).click();
    await expect(scorecard).toHaveCount(0);
    await expect(page.getByText("Cliquez une ville pour voir le détail")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Province", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
