import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Cases INDÉPENDANTES n° de zone / n° de lot (légende Signaux).
 *
 * Contrat PO : DEUX cases indépendantes (« N° de zone » dans le bloc Zonage,
 * « N° de lot » dans le bloc Lots). On peut afficher zone SEUL, lot SEUL, les
 * DEUX, ou AUCUN (la bascule segmentée unique du round précédent — qui forçait
 * toujours l'un des deux — est supprimée). Défaut : n° de ZONE coché (affiché),
 * n° de lot décoché. Persistance session (localStorage, clés indépendantes).
 *
 * Comportement RENDU vérifié (pas de marqueurs de bundle) : chargement d'une
 * ville réelle (mock API, aucun docker — même pattern que zone-kind-tint.spec.ts).
 * L'état de visibilité des couches label (peintes sur canvas MapLibre) est lu via
 * l'attribut miroir posé par le socle GeoCityMapBase.
 */

const CITY_SLUG = "delson";

const BY_CITY_RESPONSE = {
  ok: true,
  totalCount: 1,
  cities: [
    {
      citySlug: CITY_SLUG,
      signalCount: 2,
      // vivierV2Counts précoce > 0 : le rail (vue B unique par défaut) lit
      // vivierV2Counts ; sans lui la ville serait masquée (compte 0).
      subsetCounts: { "": 2, z: 2, "z|m|p": 2 },
      vivierV2Counts: {
        qualified: 2,
        residentialUnknown: 0,
        excludedByReason: { non_residentiel_franc: 0, piia_non_pertinent: 0, hors_zonage: 0, derogation_hors_sujet: 0 },
        stageCounts: { avis_motion: 2, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
        stageCountsHorsZonage: { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
        stageCountsResEligible: { avis_motion: 2, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
        stageCountsResEligibleHorsZonage: { avis_motion: 0, projet_reglement: 0, consultation_publique: 0, second_projet: 0, adoption: 0, entree_vigueur: 0, inconnu: 0 },
        total: 2,
      },
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
  // Collection lots non configurée pour cette ville — repli honnête.
  await page.route(`**/api/geo/collections/qc-lots-${CITY_SLUG}/items**`, (route: Route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not found" }),
    }),
  );
}

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("Légende Signaux — cases indépendantes n° de zone / n° de lot", () => {
  test("défaut zone coché ; indépendantes ; on peut TOUT masquer ; persistées", async ({
    page,
  }) => {
    await mockSignauxApi(page);
    await page.goto("/#/signaux");
    await page.locator("button.rail-city-row", { hasText: "Delson" }).click();

    const zoneToggle = page.getByTestId("legend-zone-labels-toggle");
    const lotToggle = page.getByTestId("legend-lot-labels-toggle");
    const zoneBox = page.getByRole("checkbox", { name: "N° de zone" });
    const lotBox = page.getByRole("checkbox", { name: "N° de lot" });
    const mapBase = page.getByTestId("geo-city-map-base");

    // ── DEUX cases indépendantes (plus la bascule segmentée unique) ──────────
    await expect(zoneToggle).toBeVisible();
    await expect(lotToggle).toBeVisible();
    await expect(page.getByTestId("legend-number-toggle")).toHaveCount(0);

    // ── Défaut : n° de ZONE coché (affiché), n° de lot décoché ───────────────
    await expect(zoneBox).toBeChecked();
    await expect(lotBox).not.toBeChecked();
    await expect(mapBase).toHaveAttribute("data-zone-labels-visible", "true");
    await expect(mapBase).toHaveAttribute("data-lot-labels-visible", "false");

    // ── On peut TOUT masquer : décocher zone → aucun libellé ────────────────
    await zoneBox.uncheck();
    await expect(mapBase).toHaveAttribute("data-zone-labels-visible", "false");
    await expect(mapBase).toHaveAttribute("data-lot-labels-visible", "false");

    // ── Indépendance : cocher lot seul → lot on, zone reste off ─────────────
    await lotBox.check();
    await expect(mapBase).toHaveAttribute("data-lot-labels-visible", "true");
    await expect(mapBase).toHaveAttribute("data-zone-labels-visible", "false");

    // ── Les DEUX affichables en même temps ──────────────────────────────────
    await zoneBox.check();
    await expect(mapBase).toHaveAttribute("data-zone-labels-visible", "true");
    await expect(mapBase).toHaveAttribute("data-lot-labels-visible", "true");

    // ── Persistance session : clés indépendantes ────────────────────────────
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("signaux-show-zone-labels")))
      .toBe("1");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("signaux-show-lot-labels")))
      .toBe("1");
  });
});
