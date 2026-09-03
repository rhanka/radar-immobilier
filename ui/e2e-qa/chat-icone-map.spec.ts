import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — chat « map-contextuel ».
 *
 * Preuve du COMPORTEMENT (que les tests unitaires/guard NE prouvent pas) :
 *   1. sur la vue carte (#/signaux) l'assistant est une icône carrée dans le
 *      cluster de contrôles (`data-testid="chat-toggle"`) et la bulle flottante
 *      globale (`data-testid="chat-bubble-trigger"`) est MASQUÉE ;
 *   2. ce bouton OUVRE réellement le chat (pas de faux-câblage / replay parasite) ;
 *   3. HORS carte (#/kanban) la carte est démontée → la bulle flottante REVIENT.
 *
 * Même pattern que legend-number-toggle.spec.ts : app authentifiée mockée, une
 * ville réelle dans le rail, aucun docker.
 *
 * ⚠ NON ENCORE EXÉCUTÉ dans cette session : l'infra Playwright/headless est
 * indisponible (init ws timeout) ET les specs e2e ne font pas partie des
 * « Quality gates » de PR. Ce spec est PRÊT et doit être vérifié dès restauration
 * de l'e2e (fast-follow).
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

async function mockSignauxApi(page: Page): Promise<void> {
  await mockAuthenticated(page);
  await page.route("**/api/graph-signals/by-city", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BY_CITY_RESPONSE) }),
  );
  await page.route(`**/api/graph-signals/${CITY_SLUG}`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DETAIL_RESPONSE) }),
  );
  await page.route(`**/api/geo/${CITY_SLUG}/zones**`, (route: Route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) }),
  );
}

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("chat map-contextuel", () => {
  test("sur la carte : icône cluster présente, bulle masquée, le bouton ouvre le chat", async ({ page }) => {
    await mockSignauxApi(page);
    await page.goto("/#/signaux");
    await page.locator("button.rail-city-row", { hasText: "Delson" }).click();

    await expect(page.getByTestId("geo-city-map-base")).toBeVisible();

    // 1. Icône chat dans le cluster + bulle flottante globale MASQUÉE.
    const chatToggle = page.getByTestId("chat-toggle");
    await expect(chatToggle).toBeVisible();
    await expect(chatToggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("chat-bubble-trigger")).toHaveCount(0);

    // 2. Le bouton OUVRE réellement le chat (toggle réel, pas de faux-câblage).
    await chatToggle.click();
    await expect(page.getByRole("button", { name: "Fermer le chat" })).toBeVisible();
    await expect(chatToggle).toHaveAttribute("aria-pressed", "true");
  });

  test("hors carte : la bulle flottante revient (carte démontée)", async ({ page }) => {
    await mockSignauxApi(page);
    await page.goto("/#/signaux");
    await page.locator("button.rail-city-row", { hasText: "Delson" }).click();
    await expect(page.getByTestId("geo-city-map-base")).toBeVisible();
    // Sur la carte, chat fermé : bulle masquée par la suppression.
    await expect(page.getByTestId("chat-bubble-trigger")).toHaveCount(0);

    // Navigation hors carte → GeoCityMapBase démonté → suppression relâchée.
    await page.goto("/#/kanban");
    await expect(page.getByTestId("geo-city-map-base")).toHaveCount(0);
    await expect(page.getByTestId("chat-toggle")).toHaveCount(0);
    await expect(page.getByTestId("chat-bubble-trigger")).toBeVisible();
  });
});
