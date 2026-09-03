import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Matrice 20×127 : dénominateur B + récence calculés LIVE côté
 * client depuis /api/graph-signals/by-city (lock conducteur « matrix-clientside
 * -live »). On PROUVE ici le CHEMIN DE RENDU en vrai Chromium (headless
 * jetable, aucun docker) : l'app fetch by-city (3 fenêtres), calcule la cohorte
 * B avec le prédicat EXACT de la vue Signaux (countForVivierCity), et rend le
 * dénominateur + les comptes de récence + le tri priorité.
 *
 * ⚠️ Ce test prouve le MÉCANISME avec des données MOCKÉES (le mock contourne le
 * 401 SSO). Le nombre LIVE réel (127/36) n'est visible que dans la session
 * authentifiée de l'owner sur prod — il n'est PAS asserté ici (ce serait un
 * faux-vert offline). Ici : cohorte mock = 3 villes B, 1 < 3 mois.
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

// Ville B : le compte précoce résidentiel-éligible porte le prédicat B par
// défaut (« vivier-v2 ») — c'est ce que lit countForVivierCity côté matrice.
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

function nonBCity(slug: string) {
  return { citySlug: slug, signalCount: 0, subsetCounts: {} };
}

// westmount est priorité dans le fallback embarqué → doit remonter en tête.
const ALL = {
  ok: true,
  totalCount: 4,
  cities: [
    bCity("westmount", 2),
    bCity("beloeil", 1),
    bCity("saint-lambert", 1),
    nonBCity("ville-non-b"),
  ],
};
const WIN_3MO = { ok: true, totalCount: 1, cities: [bCity("westmount", 2)] };
const WIN_6MO = {
  ok: true,
  totalCount: 2,
  cities: [bCity("westmount", 2), bCity("beloeil", 1)],
};

async function mockByCity(page: Page): Promise<void> {
  await mockAuthenticated(page);
  // Enregistrée APRÈS le catch-all de mockAuthenticated → prioritaire. La
  // fenêtre (dateFrom) sélectionne la cohorte, comme le serveur date-aware.
  await page.route("**/api/graph-signals/by-city**", (route: Route) => {
    const url = new URL(route.request().url());
    const dateFrom = url.searchParams.get("dateFrom");
    let body = ALL;
    if (dateFrom) {
      const daysAgo = Math.round(
        (Date.now() - new Date(`${dateFrom}T00:00:00Z`).getTime()) / 86_400_000,
      );
      body = daysAgo <= 100 ? WIN_3MO : WIN_6MO;
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test.describe("Matrice — dénominateur B LIVE (chemin de rendu)", () => {
  test("rend le dénominateur B + récence depuis by-city ; priorité en tête ; toggle récence", async ({
    page,
  }) => {
    await mockByCity(page);
    await page.goto("/#/matrice");

    // Dénominateur = 3 villes B (la ville non-B est exclue), calculé LIVE.
    await expect(page.getByTestId("palier-denominator")).toHaveText("3");
    await expect(page.getByTestId("palier-recency-lt3mo")).toHaveText("1");
    await expect(page.getByTestId("palier-recency-lt6mo")).toHaveText("2");

    // Priorité (westmount, réf. fallback) en première ligne de données.
    const firstRow = page
      .locator("[data-testid='palier-grid'] tbody tr")
      .first();
    await expect(firstRow).toHaveAttribute(
      "data-testid",
      "palier-row-westmount",
    );

    // Toggle « < 3 mois » : seule la cohorte lt3mo (westmount) reste listée.
    await page.getByTestId("palier-recency-btn-lt3mo").click();
    await expect(page.getByTestId("palier-row-westmount")).toBeVisible();
    await expect(page.getByTestId("palier-row-beloeil")).toHaveCount(0);
    await expect(page.getByTestId("palier-row-saint-lambert")).toHaveCount(0);
  });
});
