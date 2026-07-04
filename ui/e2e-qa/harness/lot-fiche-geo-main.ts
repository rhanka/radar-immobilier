/**
 * Harnais QA — fiche lot du panneau Signaux alimentée par les propriétés
 * SERVIES PAR GEO sur la collection OGC `qc-lots-<slug>` :
 * `superficie_m2` (aire réelle), `frontage_m` (façade canonique), `adresse`
 * et `code_postal`.
 *
 * PREUVE DE CONSOMMATION BOUT-EN-BOUT : le harnais stubbe `fetch` avec une
 * réponse OGC brute (noms snake_case côté geo) puis passe par le VRAI
 * `fetchLots` (mapping lots-client) avant de monter SignauxSelPanel — aucun
 * court-circuit du mapping.
 *
 * Deux lots pilotés par `?lot=` :
 *   - `full`  : les 4 champs geo présents → la fiche s'allume (superficie
 *     réelle, façade canonique SANS « estimée », adresse, code postal) ;
 *   - `empty` : aucun champ servi → « — » honnête partout, façade en repli
 *     ESTIMATION géométrique immo étiquetée « ≈ … (estimée) ».
 *
 * Anti-PII (Loi 25) : adresse/code postal = données publiques du rôle
 * (identifient la propriété, jamais une personne). Aucun propriétaire.
 */
import "../../src/app.css";
import { mount } from "svelte";
import SignauxSelPanel from "../../src/lib/components/maps/SignauxSelPanel.svelte";
import { fetchLots } from "../../src/lib/maps/lots-client.js";
import type { CityMapEntry } from "../../src/lib/maps/maps-data.js";
import {
  createSelectionBucketState,
  makeKey,
  setFocus,
  toggleSelection,
  type SelectionBucketState,
  type SelectionKey,
} from "../../src/lib/maps/selection-bucket.js";

const target = document.getElementById("harness-root");
if (!target) throw new Error("Missing #harness-root");

const CITY_SLUG = "ville-qa";
const NO_LOT_FULL = "1 000 001";
const NO_LOT_EMPTY = "1 000 002";

// Rectangle ~20 m × 40 m à 45,4° N (approx. équirectangulaire) : le lot SANS
// champs geo doit retomber sur l'estimation immo « ≈ 20 m (estimée) ».
const D_LON = 20 / (111320 * Math.cos((45.4 * Math.PI) / 180));
const D_LAT = 40 / 111320;
const RECT_20x40 = {
  type: "Polygon",
  coordinates: [[
    [-73.5, 45.4],
    [-73.5 + D_LON, 45.4],
    [-73.5 + D_LON, 45.4 + D_LAT],
    [-73.5, 45.4 + D_LAT],
    [-73.5, 45.4],
  ]],
};

// Réponse OGC BRUTE telle que geo la servira (propriétés snake_case).
const OGC_LOTS = {
  type: "FeatureCollection",
  numberMatched: 2,
  numberReturned: 2,
  features: [
    {
      type: "Feature",
      geometry: RECT_20x40,
      properties: {
        noLot: NO_LOT_FULL,
        zone_code: "H-12",
        // Les 4 propriétés servies par geo (décision : GEO les sert, l'immo
        // les CONSOMME — aucun calcul immo).
        superficie_m2: 650.4,
        frontage_m: 22.9,
        adresse: "123 rue des Érables",
        code_postal: "J5B 1B4",
      },
    },
    {
      type: "Feature",
      geometry: RECT_20x40,
      properties: {
        noLot: NO_LOT_EMPTY,
        // AUCUN champ geo servi → « — » honnête dans la fiche.
      },
    },
  ],
};

// Stub réseau : la collection lots renvoie la réponse OGC brute ; tout autre
// appel répond 404 (le harnais ne touche jamais un backend réel).
const originalFetch = window.fetch;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes(`/api/geo/collections/qc-lots-${CITY_SLUG}/items`)) {
    return new Response(JSON.stringify(OGC_LOTS), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
  }
  return originalFetch(input, init);
};

const selectedCity: CityMapEntry = {
  municipality: {
    slug: CITY_SLUG,
    name: "Ville QA",
    mrc: "QA",
    lat: 45.4,
    lon: -73.5,
    population: 1000,
    distanceToMtlKm: 20,
    priorityRank: 1,
    excluded: false,
    excludedReason: null,
    deprioritized: false,
  },
  signalCount6m: 0,
  subsetCounts: {},
};

// `?lot=empty` → pré-focus du lot SANS champs geo ; défaut : lot complet.
const params = new URLSearchParams(window.location.search);
const focusedNoLot = params.get("lot") === "empty" ? NO_LOT_EMPTY : NO_LOT_FULL;

async function boot(): Promise<void> {
  // VRAI chemin de consommation : réponse OGC brute → mapping lots-client.
  const lotsResponse = await fetchLots(CITY_SLUG, { baseUrl: "" });

  const lotKey = makeKey("lot", `${CITY_SLUG}/${focusedNoLot}`) as SelectionKey;
  let selectionState: SelectionBucketState = createSelectionBucketState();
  selectionState = toggleSelection(selectionState, lotKey);
  selectionState = setFocus(selectionState, lotKey);

  mount(SignauxSelPanel, {
    target: target as HTMLElement,
    props: {
      selectedCity,
      detailNodes: [],
      lotsResponse,
      selectionState,
    },
  });
}

void boot();
