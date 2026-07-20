import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — UAT round2, correctifs m4 (cadrage 2e lot) + m5 (défaut n° de
 * zone + migration legacy). Rendu réel (mock API, aucun docker), même pattern
 * que legend-number-toggle.spec.ts.
 *
 * m4 : sélectionner un 2e lot depuis le pane droit recadre la caméra SUR ce
 *      lot — jamais un reset vers la zone/ville. Observé via le miroir DOM
 *      `data-last-fit-bounds` posé par le socle GeoCityMapBase (seul signal DOM
 *      d'un cadrage caméra peint sur canvas WebGL).
 * m5 : défaut = n° de ZONE affiché ; les anciennes clés « deux cases » (false)
 *      ne réimposent pas masqué/lot et sont purgées.
 */

const CITY_SLUG = "delson";

// subsetCounts["z|m|p"] > 0 : sinon le rail masque la ville (filtre count 0).
// Le détail (pane) reste vide : m4/m5 ne dépendent pas des signaux.
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

// Deux zones (contour Delson) → zonesResponse.zoneCount = 2 : PAS d'auto-
// sélection du 1er lot (on veut une sélection pane explicite, propre).
function zone(code: string, dx: number) {
  const lon = -73.555 + dx;
  const lat = 45.345;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon, lat],
          [lon + 0.01, lat],
          [lon + 0.01, lat + 0.008],
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
      kind: "VP",
      affectation: "Villégiature paysagère",
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
    features: [zone("VP-101", 0), zone("VP-102", 0.02)],
  },
};

// Deux lots BIEN séparés → bboxes distinctes et non dégénérées.
const LOT_A = { noLot: "A-1", minLon: -73.56, minLat: 45.34, maxLon: -73.558, maxLat: 45.342 };
const LOT_B = { noLot: "B-2", minLon: -73.5, minLat: 45.3, maxLon: -73.498, maxLat: 45.302 };

/** Signature W,S,E,N arrondie — miroir de fitMapToBounds (socle). */
function fitSignature(l: { minLon: number; minLat: number; maxLon: number; maxLat: number }) {
  return [l.minLon, l.minLat, l.maxLon, l.maxLat].map((n) => n.toFixed(4)).join(",");
}

function lotFeature(l: { noLot: string; minLon: number; minLat: number; maxLon: number; maxLat: number }) {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [l.minLon, l.minLat],
          [l.maxLon, l.minLat],
          [l.maxLon, l.maxLat],
          [l.minLon, l.maxLat],
          [l.minLon, l.minLat],
        ],
      ],
    },
    properties: { noLot: l.noLot },
  };
}

const LOTS_RESPONSE = {
  type: "FeatureCollection",
  numberMatched: 2,
  numberReturned: 2,
  features: [lotFeature(LOT_A), lotFeature(LOT_B)],
};

async function mockSignauxApi(page: Page): Promise<void> {
  await mockAuthenticated(page);
  await page.route("**/api/graph-signals/by-city", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BY_CITY_RESPONSE) }),
  );
  await page.route(`**/api/graph-signals/${CITY_SLUG}`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DETAIL_RESPONSE) }),
  );
  await page.route(`**/api/geo/${CITY_SLUG}/zones**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZONES_RESPONSE) }),
  );
  await page.route(`**/api/geo/collections/qc-lots-${CITY_SLUG}/items**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LOTS_RESPONSE) }),
  );
}

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("UAT round2 — m4 cadrage 2e lot + m5 défaut zone / migration", () => {
  test("m4 — sélectionner un 2e lot recadre sur lui (pas de reset viewport)", async ({ page }) => {
    await mockSignauxApi(page);
    await page.goto("/#/signaux");
    await page.locator("button.rail-city-row", { hasText: "Delson" }).click();

    const mapBase = page.getByTestId("geo-city-map-base");
    // m5 (rappel) : défaut = n° de zone affiché à l'ouverture de la ville.
    await expect(mapBase).toHaveAttribute("data-zone-labels-visible", "true");

    // Déplie l'accordéon Lots de façon déterministe (il peut être déjà ouvert
    // si une ville sans zones auto-sélectionne son 1er lot).
    const lotsDetails = page.locator("details.sel-bucket", {
      has: page.locator(".sel-bucket-name", { hasText: "Lots" }),
    });
    await lotsDetails.evaluate((d) => ((d as HTMLDetailsElement).open = true));

    const lotBtn = (noLot: string) =>
      page.locator("button.sel-entity-head", { hasText: noLot });
    await expect(lotBtn(LOT_A.noLot)).toBeVisible();
    await expect(lotBtn(LOT_B.noLot)).toBeVisible();

    // Chaque sélection de lot recadre EXACTEMENT sur ce lot (bbox = miroir).
    // Lot B d'abord (le 1er lot peut être auto-focalisé) : cadrage sur B.
    await lotBtn(LOT_B.noLot).click();
    await expect(mapBase).toHaveAttribute("data-last-fit-bounds", fitSignature(LOT_B));

    // Puis lot A : cadrage sur A (la caméra suit le lot cliqué).
    await lotBtn(LOT_A.noLot).click();
    await expect(mapBase).toHaveAttribute("data-last-fit-bounds", fitSignature(LOT_A));

    // Scénario PO : lot A sélectionné + zoomé → sélectionner un 2e lot (B) →
    // la caméra recadre SUR le lot B, JAMAIS un reset vers la zone/ville.
    await lotBtn(LOT_B.noLot).click();
    await expect(mapBase).toHaveAttribute("data-last-fit-bounds", fitSignature(LOT_B));

    // Garde anti-régression : les deux cadrages de lot sont distincts (le 2e
    // lot n'a pas laissé le viewport sur le lot A).
    expect(fitSignature(LOT_B)).not.toBe(fitSignature(LOT_A));
  });

  test("m5 — anciennes clés à false → n° de zone affiché + legacy purgé", async ({ page }) => {
    await mockSignauxApi(page);
    // Pré-seed du legacy-state « deux cases » (round-1) : tout masqué.
    await page.addInitScript(() => {
      localStorage.setItem("signaux-show-zone-labels", "0");
      localStorage.setItem("signaux-show-lot-labels", "0");
    });
    await page.goto("/#/signaux");
    await page.locator("button.rail-city-row", { hasText: "Delson" }).click();

    const mapBase = page.getByTestId("geo-city-map-base");
    // Le legacy « false » ne réimpose PAS masqué : défaut = zone affiché.
    await expect(mapBase).toHaveAttribute("data-zone-labels-visible", "true");
    await expect(mapBase).toHaveAttribute("data-lot-labels-visible", "false");
    // Clés legacy purgées, clé round-2 non écrite tant qu'aucun choix explicite.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("signaux-show-zone-labels")))
      .toBeNull();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("signaux-show-lot-labels")))
      .toBeNull();
  });

  test("m5 — choix `lot` persiste au rechargement (distinct du défaut)", async ({ page }) => {
    await mockSignauxApi(page);
    await page.addInitScript(() => {
      localStorage.setItem("signaux-legend-label-mode", "lot");
    });
    await page.goto("/#/signaux");
    await page.locator("button.rail-city-row", { hasText: "Delson" }).click();

    const mapBase = page.getByTestId("geo-city-map-base");
    await expect(mapBase).toHaveAttribute("data-lot-labels-visible", "true");
    await expect(mapBase).toHaveAttribute("data-zone-labels-visible", "false");
  });
});
