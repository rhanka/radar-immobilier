import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Bascule UNIQUE n° de zone / n° de lot (légende Signaux,
 * suite UAT round2).
 *
 * Round précédent (m5) : 2 cases indépendantes (« N° de zone » dans le bloc
 * Zonage + « N° de lot » dans le bloc Lots), défaut MASQUÉ, typo `Checkbox`
 * DS non alignée sur les autres entrées de légende (« Habitation »…).
 *
 * Retours PO (round2) :
 *   1. UNE SEULE bascule EXCLUSIVE (segmented control DS 2 positions,
 *      remplace les 2 cases).
 *   2. Défaut = n° de ZONE AFFICHÉ au chargement de la vue ville.
 *   3. Typo (taille + couleur) du libellé ALIGNÉE sur les autres entrées de
 *      légende (mêmes tokens DS).
 *
 * Comportement RENDU vérifié (pas de marqueurs de bundle) : chargement d'une
 * ville réelle (mock API, aucun docker — même pattern que
 * zone-kind-tint.spec.ts) → segment "N° de zone" actif + libellés de zone
 * effectivement demandés à la carte (attribut miroir posé par le socle
 * GeoCityMapBase, seul signal DOM disponible pour un état de couche MapLibre
 * peint sur canvas) ; clic "N° de lot" → bascule EXCLUSIVE (zone off / lot
 * on), persistée ; typographie du libellé identique aux entrées de légende.
 */

const CITY_SLUG = "delson";

const BY_CITY_RESPONSE = {
  ok: true,
  totalCount: 1,
  cities: [
    {
      citySlug: CITY_SLUG,
      signalCount: 2,
      subsetCounts: { "": 2, z: 2, "z|m|p": 2 },
    },
  ],
};

const DETAIL_RESPONSE = {
  ok: true,
  citySlug: CITY_SLUG,
  legacyProjection: { version: "legacy-zmp-v1", a: { count: 0, signalIds: [] } },
  nodes: [],
};

/** Zones réelles (contour Delson, cf. zone-kind-tint.spec.ts) — kind VP/CV-RF → famille « Habitation ». */
function zone(code: string, kind: string, affectation: string, dx: number, dy: number) {
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
      citySlug: CITY_SLUG,
      geometryStatus: "official",
      confidence: 1,
      source: "official-zone",
      lotCount: 0,
      lots: [],
      kind,
      affectation,
    },
  };
}

const ZONES_RESPONSE = {
  ok: true,
  citySlug: CITY_SLUG,
  source: "official",
  resolutionStatus: "official",
  geometryStatus: "official",
  zoneCount: 2,
  warnings: [],
  featureCollection: {
    type: "FeatureCollection",
    features: [
      zone("VP-101", "VP", "Villégiature paysagère", 0, 0),
      zone("CV-RF-1", "CV-RF", "CV - Résidentielle de faible densité", 0.014, 0),
    ],
  },
};

async function mockSignauxApi(page: Page): Promise<void> {
  await mockAuthenticated(page);
  // Enregistrées APRÈS le catch-all de mockAuthenticated → prioritaires.
  await page.route("**/api/graph-signals/by-city", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(BY_CITY_RESPONSE),
    }),
  );
  await page.route(`**/api/graph-signals/${CITY_SLUG}`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(DETAIL_RESPONSE),
    }),
  );
  await page.route(`**/api/geo/${CITY_SLUG}/zones**`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ZONES_RESPONSE),
    }),
  );
  // Collection lots non configurée pour cette ville — repli honnête (pas
  // d'erreur bruyante, hors périmètre de ce test).
  await page.route(`**/api/geo/collections/qc-lots-${CITY_SLUG}/items**`, (route: Route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not found" }),
    }),
  );
}

async function textStyle(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, color: cs.color };
  });
}

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("Légende Signaux — bascule unique n° de zone / n° de lot (UAT round2)", () => {
  test("défaut = zone affiché ; bascule exclusive vers lot ; typo alignée sur la légende", async ({
    page,
  }) => {
    await mockSignauxApi(page);
    await page.goto("/#/signaux");
    await page.locator("button.rail-city-row", { hasText: "Delson" }).click();

    const zoneSegment = page.getByTestId("legend-number-toggle-zone");
    const lotSegment = page.getByTestId("legend-number-toggle-lot");
    const mapBase = page.getByTestId("geo-city-map-base");

    // ── UNE SEULE bascule (plus les 2 cases indépendantes du round précédent) ─
    await expect(page.getByTestId("legend-number-toggle")).toBeVisible();
    await expect(zoneSegment).toBeVisible();
    await expect(lotSegment).toBeVisible();
    await expect(page.getByTestId("legend-zone-labels-toggle")).toHaveCount(0);
    await expect(page.getByTestId("legend-lot-labels-toggle")).toHaveCount(0);

    // ── Défaut : n° de ZONE affiché au chargement de la vue ville ───────────
    await expect(zoneSegment).toHaveAttribute("aria-pressed", "true");
    await expect(lotSegment).toHaveAttribute("aria-pressed", "false");
    await expect(mapBase).toHaveAttribute("data-zone-labels-visible", "true");
    await expect(mapBase).toHaveAttribute("data-lot-labels-visible", "false");

    // ── Typo (taille + couleur) alignée sur les autres entrées de légende ───
    const legendEntry = page.locator("li", { hasText: "Habitation" }).first();
    await expect(legendEntry).toBeVisible();
    const legendStyle = await textStyle(legendEntry);

    // Segment ACTIF (zone) : même TAILLE que le reste de la légende (la
    // couleur active porte volontairement l'emphase DS du choix sélectionné).
    const zoneStyle = await textStyle(zoneSegment);
    expect(zoneStyle.fontSize).toBe(legendStyle.fontSize);

    // Segment INACTIF (lot, au repos) : même taille ET même couleur que les
    // autres entrées de légende — c'est CE mismatch que le PO a signalé sur
    // le libellé `Checkbox` du round précédent.
    const lotStyle = await textStyle(lotSegment);
    expect(lotStyle.fontSize).toBe(legendStyle.fontSize);
    expect(lotStyle.color).toBe(legendStyle.color);

    // ── Bascule EXCLUSIVE vers n° de lot ─────────────────────────────────────
    await lotSegment.click();
    await expect(lotSegment).toHaveAttribute("aria-pressed", "true");
    await expect(zoneSegment).toHaveAttribute("aria-pressed", "false");
    await expect(mapBase).toHaveAttribute("data-lot-labels-visible", "true");
    await expect(mapBase).toHaveAttribute("data-zone-labels-visible", "false");

    // Segment ZONE redevenu inactif : typo toujours alignée sur la légende.
    const zoneInactiveStyle = await textStyle(zoneSegment);
    expect(zoneInactiveStyle.fontSize).toBe(legendStyle.fontSize);
    expect(zoneInactiveStyle.color).toBe(legendStyle.color);

    // Choix persisté (session) — le bascule tient au fil des rechargements.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("signaux-legend-label-mode")))
      .toBe("lot");
  });
});
