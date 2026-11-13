import { expect, type Page } from "@playwright/test";
import { openPerimeter } from "./signals-perimeter-fixture";

export const EXCLUSION_LABELS = ["Exclure PIIA sans projet résidentiel", "Exclure dérogations mineures"];
export const RAIL_URL = "/geo/region/quebec?mode=signal&filter.period=7d&filter.zonage=1&filter.residentiel=1&filter.precoce=1";

/** Two equal cities: one zoning signal, two PIIAs (one proven), one derogation. */
export async function openExclusions(page: Page, baseURL: string, navigate = true): Promise<void> {
  await openPerimeter(page, baseURL, false);
  const nodes = ["rezonage", "piia", "piia", "derogation"].map((instrument, index) => ({
    id: `signal-${index}`, type: "Signal", citySlug: "delson", label: `Case ${index} ${instrument}`,
    props: { properties: { zone_ref: "H-01", ...(index === 2 ? { nb_unites_max: 4 } : {}) },
      refs: [{ publishedAt: "2026-03-30" }] },
    sourceRef: null, facetFingerprint: "qa-fingerprint",
    classification: { zonage: { valeur: "oui", source: "test", confiance: 1 },
      residentiel: { valeur: "oui", source: "test", confiance: 1 }, effet_densifiant: "inconnu",
      instrument, etape: "avis_motion", etapes_historique: ["avis_motion"],
      exclusion_reason: null, provenance: { extrait: "" }, confiance: 1 },
  }));
  await page.route("**/signal-facets/coherent-city**", route => route.fulfill({ json: {
    ok: true, token: "qa-exclusions", signals: nodes, legacyProjection: null, heads: [],
    selection: nodes.slice(0, 2).map(node => ({ target: { citySlug: "delson", type: "Signal", id: node.id },
      facet: "selection", basket: "pertinent", state: "active", reasonCode: null })),
    counts: { total: 4, hidden: 0, visible: 4, selected: 2 },
  } }));
  await page.route("**/signal-facets/by-city**", route => route.fulfill({ json: {
    ok: true, totalCount: 8, cities: ["delson", "candiac"].map(citySlug => ({
      citySlug, signalCount: 4, subsetCounts: {},
      vivierV2Counts: { total: 4, qualified: 4, residentialUnknown: 0,
        excludedByReason: {}, stageCounts: { avis_motion: 4 }, stageCountsResEligible: { avis_motion: 4 },
        stageCountsHorsZonage: {}, stageCountsResEligibleHorsZonage: {} },
      filtreCube: { "11100": 2, "11110": 1, "11101": 1 },
      filtreCubesByClassement: { pertinent: { "11100": 1, "11110": 1 }, a_surveiller: {},
        non_classe: { "11100": 1, "11101": 1 }, ecarte: {} },
    })),
  } }));
  if (navigate) {
    await page.goto(`${baseURL}${RAIL_URL}`);
    await expect(page.locator("button.rail-city-row")).toHaveCount(2);
  }
}
