import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Vue Signaux, tab Vivier B : 3 comportements rendus (RED→GREEN).
 *
 * fix/filters-behavior-v2 :
 *   1. Défaut B = Zonage✓ Résidentiel✓ Précoce✓ (l'ancien défaut Précoce✗ noyait
 *      l'utilisateur dans tout le vivier qualifié dès l'entrée dans B).
 *   2. Le BADGE du rail (par ville) doit suivre les filtres CLIENT actifs
 *      (exclusions d'affichage B) pour la ville SÉLECTIONNÉE — pas rester figé
 *      au compte bulk serveur qu'ignorent ces exclusions (cas Westmount « 5 »
 *      pendant que le panneau droit affichait 2 puis 3).
 *   3. Un axe basculé en B (ex. Précoce décoché) doit PERSISTER quand on
 *      clique une autre ville dans le rail (même mode, pas un deep-link A↔B).
 *
 * Aucun docker : vite preview + routes /api mockées (fixtures ci-dessous).
 */

type TriState = "oui" | "non" | "indetermine";

function signalNode(
  id: string,
  citySlug: string,
  instrument: string,
  opts: { residentiel?: TriState } = {},
) {
  return {
    id,
    type: "Signal",
    label: id,
    citySlug,
    sourceRef: null,
    createdAt: "2026-05-01T00:00:00Z",
    props: { properties: {} },
    classification: {
      zonage: { valeur: "oui", source: "t", confiance: 0.9 },
      residentiel: { valeur: opts.residentiel ?? "oui", source: "t", confiance: 0.9 },
      effet_densifiant: "inconnu",
      instrument,
      etape: "avis_motion",
      etapes_historique: ["avis_motion"],
      exclusion_reason: null,
      provenance: { extrait: "" },
      confiance: 0.9,
    },
  };
}

/** Comptes v2 bulk serveur : total = qualified + residentialUnknown + Σ exclusions. */
function bulkCounts(qualified: number) {
  return {
    qualified,
    residentialUnknown: 0,
    excludedByReason: {
      non_residentiel_franc: 0,
      piia_non_pertinent: 0,
      hors_zonage: 0,
      derogation_hors_sujet: 0,
    },
    stageCounts: {
      avis_motion: qualified,
      projet_reglement: 0,
      consultation_publique: 0,
      second_projet: 0,
      adoption: 0,
      entree_vigueur: 0,
      inconnu: 0,
    },
    total: qualified,
  };
}

// Westmount : 3 nœuds QUALIFIÉS côté serveur (bulk = 3, exactement le cas
// « Westmount 5 » du bug m1.7 — ici 3 pour rester lisible), mais 2 masqués par
// défaut par les exclusions d'AFFICHAGE (PIIA sans preuve + dérogation) →
// seul 1 visible par défaut. MRC `null` (pas de collision de sous-libellé).
const WESTMOUNT_NODES = [
  signalNode("rezonage-qualifie", "westmount", "rezonage"),
  signalNode("piia-sans-projet", "westmount", "piia"),
  signalNode("derogation-mineure", "westmount", "derogation"),
];

// Salaberry-de-Valleyfield : 1 seul nœud, uniquement utile pour prouver la
// persistance d'un axe basculé (m1.8) au clic ville — le contenu importe peu
// ici. MRC "Beauharnois-Salaberry" ne collisionne pas avec "Westmount" (MRC
// null) dans les sélecteurs par texte.
const SALABERRY_NODES = [
  signalNode("salaberry-rezonage", "salaberry-de-valleyfield", "rezonage"),
];

async function mockSignauxApi(page: Page): Promise<void> {
  await mockAuthenticated(page);
  // Enregistrées APRÈS le catch-all de mockAuthenticated → prioritaires.
  await page.route("**/api/graph-signals/by-city", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        totalCount: 2,
        cities: [
          {
            citySlug: "westmount",
            signalCount: 3,
            subsetCounts: {},
            vivierV2Counts: bulkCounts(3),
          },
          {
            citySlug: "salaberry-de-valleyfield",
            signalCount: 1,
            subsetCounts: {},
            vivierV2Counts: bulkCounts(1),
          },
        ],
      }),
    }),
  );
  await page.route("**/api/graph-signals/westmount", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        citySlug: "westmount",
        legacyProjection: null,
        nodes: WESTMOUNT_NODES,
      }),
    }),
  );
  await page.route("**/api/graph-signals/salaberry-de-valleyfield", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        citySlug: "salaberry-de-valleyfield",
        legacyProjection: null,
        nodes: SALABERRY_NODES,
      }),
    }),
  );
}

function cityRows(page: Page) {
  return page.locator("button.rail-city-row");
}

function cityRow(page: Page, name: string) {
  return cityRows(page).filter({ hasText: name });
}

function checkbox(page: Page, label: string) {
  // `exact` : "Résidentiel" (axe) et "Exclure PIIA sans projet résidentiel"
  // (exclusion) partagent la sous-chaîne "résidentiel" — un match approximatif
  // résoudrait les deux (strict mode violation).
  return page.getByRole("checkbox", { name: label, exact: true });
}

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("Signaux — tab Vivier B (rendu réel)", () => {
  test.beforeEach(async ({ page }) => {
    await mockSignauxApi(page);
    await page.goto("/#/signaux");
    // Tab A par défaut lit `subsetCounts["z|m|p"]` (non peuplé par la fixture,
    // seul le vivier v2 de B l'est) : basculer en B AVANT d'attendre les
    // lignes du rail, qui ne comptent que sur `vivierV2Counts`.
    await page.getByRole("tab", { name: "Nouveau B" }).click();
    await cityRows(page).first().waitFor({ state: "visible", timeout: 15_000 });
  });

  test("1 — le tab B s'ouvre avec Précoce COCHÉ par défaut", async ({ page }) => {
    await expect(checkbox(page, "Zonage")).toBeChecked();
    await expect(checkbox(page, "Résidentiel")).toBeChecked();
    await expect(checkbox(page, "Précoce")).toBeChecked();
  });

  test("2 — le badge de la ville SÉLECTIONNÉE suit les exclusions, jamais le bulk figé", async ({
    page,
  }) => {
    await cityRow(page, "Westmount").click();

    // Défaut : les 2 exclusions actives → seul le rezonage visible (1).
    // Le bulk serveur (vivierV2Counts.qualified = 3) ne doit PLUS être affiché
    // sur la ligne une fois la ville sélectionnée : c'est le bug « Westmount 5 ».
    await expect(cityRow(page, "Westmount")).toContainText("1");
    await expect(cityRow(page, "Westmount")).not.toContainText("3");

    await checkbox(page, "Exclure PIIA sans projet résidentiel").uncheck();
    await expect(cityRow(page, "Westmount")).toContainText("2");

    await checkbox(page, "Exclure dérogations mineures").uncheck();
    // Sans aucune exclusion, le badge converge vers le bulk (3 = 3 nœuds qualifiés).
    await expect(cityRow(page, "Westmount")).toContainText("3");
  });

  test("3 — un axe basculé (Précoce décoché) persiste au clic d'une autre ville", async ({
    page,
  }) => {
    await cityRow(page, "Westmount").click();
    await checkbox(page, "Précoce").uncheck();
    await expect(checkbox(page, "Précoce")).not.toBeChecked();

    await cityRow(page, "Salaberry-de-Valleyfield").click();
    await expect(cityRow(page, "Salaberry-de-Valleyfield")).toHaveClass(
      /rail-city-row--active/,
    );
    // Le mode reste B et l'axe décoché survit à la navigation ville
    // (reconcileVivierRouteSubset : même mode ⇒ clé LIVE conservée).
    await expect(page.getByRole("tab", { name: "Nouveau B" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(checkbox(page, "Précoce")).not.toBeChecked();
  });
});
