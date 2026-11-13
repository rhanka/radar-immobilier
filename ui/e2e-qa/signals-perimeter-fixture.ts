import { expect, type Page } from '@playwright/test';
import { mockAuthenticated } from './_helpers';
const classes = ['pertinent', 'a_surveiller', 'non_classe', 'ecarte'] as const;
export async function openPerimeter(page: Page, baseURL: string): Promise<void> {
  let restored = false;
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
        classe === "ecarte" ? (citySlug === "delson" ? { "11100": multiplier - Number(restored), "11000": 1 } : {})
          : { "11100": (index + 1) * multiplier + Number(restored && citySlug === "delson" && classe === "non_classe"), "11000": 1 }])),
    })), totalCount: 2 * total } });
  });
  const signals = classes.slice(0, 3).flatMap((classe, index) =>
    Array.from({ length: index + 2 }, (_, i) => ({
      id: `${classe}-${i}`, type: "Signal", label: `Residential zoning ${classe} ${i}`, citySlug: "delson", facetFingerprint: "qa-fingerprint",
      sourceRef: null, props: { refs: [{ publishedAt: "2026-03-30" }], properties: { zone_ref: "H-01" } },
      classification: { zonage: { valeur: "oui", source: "test", confiance: 1 },
        residentiel: { valeur: "oui", source: "test", confiance: 1 }, effet_densifiant: "inconnu",
        instrument: "rezonage", etape: i === index + 1 ? "adoption" : "avis_motion",
        etapes_historique: [i === index + 1 ? "adoption" : "avis_motion"],
        exclusion_reason: null, provenance: { extrait: "" }, confiance: 1 },
    })));
  const archived = { ...signals[0], id: "de_2026_0129", label: "PPCMOI 2026-0129 boulevard Laurette-Théorêt" };
  await page.route("**/signal-facets/personal/reclassify", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      target: { citySlug: "delson", type: "Signal", id: archived.id },
      archives: { personal: "archive-head" }, displayedFingerprint: "qa-fingerprint",
      selectionHeads: { pertinent: null, a_surveiller: null }, nextClass: "non_classe",
    });
    restored = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/signal-facets/coherent-city**", (route) => route.fulfill({ json: {
    ok: true, token: `qa-revision-${restored}`, signals: restored || new URL(route.request().url()).searchParams.get("showDiscarded") === "1"
      ? [...signals, archived] : signals, legacyProjection: null,
    selection: signals.filter((node) => !node.id.startsWith("non_classe")).map((node) => ({
      target: { citySlug: "delson", type: node.type, id: node.id }, facet: "selection",
      basket: node.id.startsWith("pertinent") ? "pertinent" : "a_surveiller", state: "active", reasonCode: null,
    })),
    heads: [{ target: { citySlug: "delson", type: "Signal", id: archived.id },
      effectiveDiscarded: !restored, workspace: null, personal: { id: restored ? "restored-head" : "archive-head", state: restored ? "inactive" : "active", reasonCode: "N-NON-RES" } }],
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

