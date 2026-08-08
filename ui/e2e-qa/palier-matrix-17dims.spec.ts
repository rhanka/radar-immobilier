import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Matrice : les 17 dims GEO sont dérivées du LIVE servi
 * /api/source/coverage (mapping VERROUILLÉ conducteur, reroute 17dims-served).
 * On PROUVE ici le CHEMIN DE RENDU en vrai Chromium (headless jetable) : l'app
 * fetch coverage authentifié, dérive chaque cellule KPI de la couche servie, et
 * la matrice rend le statut mesuré (Complet/Partiel/À qualifier/N-A) par cellule.
 *
 * ⚠️ Données MOCKÉES (le mock contourne le 401 SSO). Les valeurs LIVE réelles ne
 * sont visibles que dans la session authentifiée de l'owner ; elles ne sont PAS
 * assertées ici (ce serait un faux-vert offline). Ici on prouve le CÂBLAGE
 * coverage→cellule (mapping conducteur), pas la valeur prod.
 */

function emptyStages() {
  return {
    avis_motion: 0,
    projet_reglement: 0,
    consultation_publique: 0,
    second_projet: 0,
    adoption: 0,
    entree_vigueur: 0,
    inconnu: 0,
  };
}
function bCity(slug: string, n: number) {
  return {
    citySlug: slug,
    signalCount: n,
    subsetCounts: {},
    vivierV2Counts: {
      qualified: n,
      residentialUnknown: 0,
      stageCounts: { ...emptyStages(), avis_motion: n },
      stageCountsHorsZonage: emptyStages(),
      stageCountsResEligible: { ...emptyStages(), avis_motion: n },
      stageCountsResEligibleHorsZonage: emptyStages(),
    },
  };
}
const BY_CITY = {
  ok: true,
  totalCount: 2,
  cities: [bCity("westmount", 2), bCity("beloeil", 1)],
};

// westmount : couches SERVIES variées (verified/declared) + sous-comptes normes.
const COVERAGE = {
  generatedAt: "2026-08-08T00:00:00.000Z",
  totals: { cities: 1, l1Raw: 1, l2Graph: 1, signals: 1, l4Zonage: 1, l5Lots: 0 },
  cities: [
    {
      citySlug: "westmount",
      cityName: "Westmount",
      mrc: null,
      priorityRank: 1,
      l1Raw: { state: "verified", count: 3, freshness: "fresh" },
      l2Graph: { state: "verified", ontologyVersion: "2.3", freshness: "fresh" },
      signals: { state: "verified", count: 10, withCitation: 10, priority: 3, freshness: "fresh" },
      l4Zonage: { state: "verified", served: true, servedBy: "geo", freshness: "fresh" },
      normes: {
        state: "declared",
        freshness: "partial",
        measured: true,
        zoneCount: 4,
        zonesWithGrille: 4,
        zonesWithReglement: 2,
        zonesWithNormativeValues: 0,
      },
      l5Lots: { state: "declared", served: true, servedBy: "local", freshness: "partial" },
      lotFields: { state: "declared", freshness: "partial" },
      tod: { state: "verified", served: true, servedBy: "geo", freshness: "fresh" },
      worstStatus: "declared",
      nextMarginalGain: null,
    },
    // beloeil ABSENT de la couverture → ses cellules geo = à qualifier honnête.
  ],
};

async function mockLive(page: Page): Promise<void> {
  await mockAuthenticated(page);
  await page.route("**/api/graph-signals/by-city**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BY_CITY) }),
  );
  await page.route("**/api/source/coverage", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(COVERAGE) }),
  );
}

test.describe("Matrice — 17 dims geo dérivées de coverage (chemin de rendu)", () => {
  test("rend les cellules geo mesurées depuis /api/source/coverage (mapping conducteur)", async ({
    page,
  }) => {
    await mockLive(page);
    await page.goto("/#/matrice");

    // Le scope B rend (2 villes) → la matrice est montée.
    await expect(page.getByTestId("palier-denominator")).toHaveText("2");

    const status = async (slug: string, kpi: string) =>
      page.getByTestId(`palier-cell-${slug}-${kpi}`).getAttribute("data-status");

    // Couches directes coverage (westmount).
    expect(await status("westmount", "kpi01")).toBe("complete"); // zonage verified
    expect(await status("westmount", "kpi02")).toBe("incomplete"); // lots declared
    // Sous-comptes normes : grille 4/4 complet ; règlement 2/4 partiel ; valeurs 0/4 à qualifier.
    expect(await status("westmount", "kpi03")).toBe("complete");
    expect(await status("westmount", "kpi05")).toBe("incomplete");
    expect(await status("westmount", "kpi06")).toBe("unknown");
    // URL-source : repli coverage-only proxy (withCitation 10/10 → complet).
    expect(await status("westmount", "kpi11")).toBe("complete");
    // TOD groupé 18/19 verified → complet.
    expect(await status("westmount", "kpi18")).toBe("complete");
    expect(await status("westmount", "kpi19")).toBe("complete");
    // Structurels : 07 = N-A (jamais complete) ; 10 = à qualifier (en cours).
    expect(await status("westmount", "kpi07")).toBe("na");
    expect(await status("westmount", "kpi10")).toBe("unknown");
    // Provenance transparente du repli #2b : source « proxy citation (repli) ».
    await expect(page.getByTestId("palier-cell-westmount-kpi11")).toHaveAttribute(
      "data-source",
      "proxy citation (repli)",
    );

    // beloeil ABSENT de la couverture → cellule geo = à qualifier (couverture absente).
    expect(await status("beloeil", "kpi01")).toBe("unknown");
    await expect(page.getByTestId("palier-cell-beloeil-kpi01")).toHaveAttribute(
      "data-source",
      "couverture absente",
    );
  });
});
