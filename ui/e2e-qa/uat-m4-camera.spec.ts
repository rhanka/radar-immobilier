import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — UAT round2, contrat caméra « lot suivant » (m4). Rendu réel
 * (mock API, aucun docker), même pattern que legend-number-toggle.spec.ts.
 *
 * Contrat PO : « recentrer sur le lot MAIS garder le zoom » —
 *  - PREMIER lot sélectionné → cadrage existant permis (fitBounds) ;
 *  - AUTRE lot de la MÊME zone → UNE commande de RECENTRAGE (easeTo) vers le
 *    centre du lot avec zoom IDENTIQUE avant/après (égalité stricte) —
 *    JAMAIS fitBounds (fitBounds change le zoom) ;
 *  - RECLIC sur le MÊME lot → ZÉRO commande caméra ;
 *  - lot d'une AUTRE zone → cadrage existant permis (peut changer le zoom).
 *
 * Observé via les miroirs DOM du socle GeoCityMapBase (seul signal DOM d'une
 * caméra peinte sur canvas WebGL) :
 *  - data-camera-command-count : nombre TOTAL de commandes caméra émises ;
 *  - data-last-camera-command  : signature de la dernière commande
 *    (`fit:W,S,E,N` | `recenter:lon,lat@zoom` | `fly:lon,lat@zoom`) ;
 *  - data-map-zoom             : zoom courant (précision pleine, maj à chaque
 *    moveend) — support de l'égalité STRICTE avant/après recentrage.
 *
 * Hors scope : la légende (n° zone/lot) reste celle de main (deux cases
 * indépendantes) — ce spec ne l'assert pas.
 */

const CITY_SLUG = "delson";

// vivierV2Counts précoce > 0 : sinon le rail (vue B unique par défaut) masque
// la ville (compte 0). subsetCounts conservé pour les chemins hérités.
// Le détail (pane) reste vide : le contrat caméra ne dépend pas des signaux.
const BY_CITY_RESPONSE = {
  ok: true,
  totalCount: 1,
  cities: [
    {
      citySlug: CITY_SLUG,
      signalCount: 2,
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

// Deux zones DISJOINTES à géométrie officielle, servies par la collection OGC
// `qc-zonage-<slug>` (tier 1 du loader zones de la vue Signaux — champ
// canonique `zone_code`). L'appartenance lot↔zone est résolue géométriquement
// (centre du lot dans le polygone de zone). Deux zones ⇒ PAS d'auto-sélection
// du 1er lot (sélections pane explicites).
function zone(
  code: string,
  extent: { minLon: number; minLat: number; maxLon: number; maxLat: number },
) {
  const { minLon, minLat, maxLon, maxLat } = extent;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    },
    properties: {
      zone_code: code,
      kind: "VP",
      affectation: "Villégiature paysagère",
    },
  };
}

const ZONE_VP101 = { minLon: -73.57, minLat: 45.33, maxLon: -73.54, maxLat: 45.36 };
const ZONE_VP102 = { minLon: -73.53, minLat: 45.33, maxLon: -73.5, maxLat: 45.36 };

const ZONES_RESPONSE = {
  type: "FeatureCollection",
  numberMatched: 2,
  numberReturned: 2,
  features: [zone("VP-101", ZONE_VP101), zone("VP-102", ZONE_VP102)],
};

// Lots A et C DANS la zone VP-101 (même zone), lot B DANS la zone VP-102
// (autre zone). Bboxes distinctes et non dégénérées.
const LOT_A = { noLot: "A-1", minLon: -73.562, minLat: 45.34, maxLon: -73.56, maxLat: 45.342 };
const LOT_C = { noLot: "C-3", minLon: -73.552, minLat: 45.35, maxLon: -73.55, maxLat: 45.352 };
const LOT_B = { noLot: "B-2", minLon: -73.522, minLat: 45.34, maxLon: -73.52, maxLat: 45.342 };

type LotBox = { noLot: string; minLon: number; minLat: number; maxLon: number; maxLat: number };

/** Signature `fit:W,S,E,N` arrondie 4 déc. — miroir de fitMapToBounds (socle). */
function fitSignature(l: LotBox): string {
  return `fit:${[l.minLon, l.minLat, l.maxLon, l.maxLat].map((n) => n.toFixed(4)).join(",")}`;
}

/** Centre de bbox arrondi 4 déc. — cible du recentrage (miroir du socle). */
function centerSignature(l: LotBox): string {
  return [(l.minLon + l.maxLon) / 2, (l.minLat + l.maxLat) / 2]
    .map((n) => n.toFixed(4))
    .join(",");
}

function lotFeature(l: LotBox) {
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
    // noLot SEUL (pas de zoneCode joint) : le chemin d'appartenance exercé est
    // le repli GÉOMÉTRIQUE (centre du lot dans le polygone de zone), comme les
    // collections OGC sans join zone.
    properties: { noLot: l.noLot },
  };
}

const LOTS_RESPONSE = {
  type: "FeatureCollection",
  numberMatched: 3,
  numberReturned: 3,
  features: [lotFeature(LOT_A), lotFeature(LOT_C), lotFeature(LOT_B)],
};

async function mockSignauxApi(page: Page): Promise<void> {
  await mockAuthenticated(page);
  await page.route("**/api/graph-signals/by-city", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BY_CITY_RESPONSE) }),
  );
  await page.route(`**/api/graph-signals/${CITY_SLUG}`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DETAIL_RESPONSE) }),
  );
  await page.route(`**/api/geo/collections/qc-zonage-${CITY_SLUG}/items**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZONES_RESPONSE) }),
  );
  await page.route(`**/api/geo/collections/qc-lots-${CITY_SLUG}/items**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LOTS_RESPONSE) }),
  );
}

/** Compteur de commandes caméra (miroir DOM du socle). */
async function commandCount(mapBase: Locator): Promise<number> {
  const raw = await mapBase.getAttribute("data-camera-command-count");
  return Number(raw ?? "0");
}

/**
 * Attend la fin des animations caméra (durées ≤ 800 ms) puis lit le zoom
 * STABILISÉ (deux lectures consécutives identiques du miroir data-map-zoom).
 */
async function settledZoom(page: Page, mapBase: Locator): Promise<string> {
  await page.waitForTimeout(1000);
  let prev = await mapBase.getAttribute("data-map-zoom");
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(250);
    const next = await mapBase.getAttribute("data-map-zoom");
    if (next !== null && next === prev) return next;
    prev = next;
  }
  throw new Error("zoom caméra non stabilisé");
}

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("UAT round2 — contrat caméra « lot suivant »", () => {
  test("autre lot même zone = recentrage zoom conservé ; reclic = 0 commande ; autre zone = cadrage permis", async ({ page }) => {
    await mockSignauxApi(page);
    await page.goto("/#/signaux");
    await page.locator("button.rail-city-row", { hasText: "Delson" }).click();

    const mapBase = page.getByTestId("geo-city-map-base");

    // Déplie l'accordéon Lots de façon déterministe.
    const lotsDetails = page.locator("details.sel-bucket", {
      has: page.locator(".sel-bucket-name", { hasText: "Lots" }),
    });
    await lotsDetails.evaluate((d) => ((d as HTMLDetailsElement).open = true));

    const lotBtn = (noLot: string) =>
      page.locator("button.sel-entity-head", { hasText: noLot });
    await expect(lotBtn(LOT_A.noLot)).toBeVisible();
    await expect(lotBtn(LOT_C.noLot)).toBeVisible();
    await expect(lotBtn(LOT_B.noLot)).toBeVisible();

    // Attendre que la CARTE soit prête (le pane peut rendre avant MapLibre) :
    // le flyTo ville est la 1re commande caméra émise une fois l'API du socle
    // livrée — sans cette attente, un clic lot partirait dans le vide
    // (mapApi encore null) et aucune commande ne serait observable.
    await expect(mapBase).toHaveAttribute("data-last-camera-command", /^fly:/, {
      timeout: 15_000,
    });
    await settledZoom(page, mapBase);

    // ── PREMIER lot (A) : cadrage existant permis (fitBounds sur le lot). ────
    await lotBtn(LOT_A.noLot).click();
    await expect(mapBase).toHaveAttribute("data-last-camera-command", fitSignature(LOT_A));
    const zoomBefore = await settledZoom(page, mapBase);
    const countAfterFirstLot = await commandCount(mapBase);

    // ── AUTRE lot MÊME zone (C, VP-101 comme A) : UNE commande de RECENTRAGE
    //    (easeTo) vers le CENTRE du lot, zoom IDENTIQUE avant/après (strict).
    await lotBtn(LOT_C.noLot).click();
    await expect(mapBase).toHaveAttribute(
      "data-last-camera-command",
      `recenter:${centerSignature(LOT_C)}@${zoomBefore}`,
    );
    expect(await commandCount(mapBase)).toBe(countAfterFirstLot + 1);
    // Égalité STRICTE du zoom après stabilisation : le recentrage n'a PAS
    // changé le zoom (jamais de fitBounds pour un lot de la même zone).
    expect(await settledZoom(page, mapBase)).toBe(zoomBefore);

    // ── RECLIC sur le MÊME lot (C) : AUCUNE commande caméra. Deux reclics pour
    //    couvrir les deux chemins du pane (referme le focus, puis re-focus).
    await lotBtn(LOT_C.noLot).click();
    await lotBtn(LOT_C.noLot).click();
    await page.waitForTimeout(500);
    expect(await commandCount(mapBase)).toBe(countAfterFirstLot + 1);
    expect(await mapBase.getAttribute("data-map-zoom")).toBe(zoomBefore);

    // ── Lot d'une AUTRE zone (B, VP-102) : cadrage existant permis (fitBounds,
    //    le zoom PEUT changer) — une seule commande, sur le lot B lui-même.
    await lotBtn(LOT_B.noLot).click();
    await expect(mapBase).toHaveAttribute("data-last-camera-command", fitSignature(LOT_B));
    expect(await commandCount(mapBase)).toBe(countAfterFirstLot + 2);
  });
});
