import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — §5 R2 Lot2 : déclencheur chat CARRÉ de la rangée de contrôles
 * carte + COEXISTENCE avec le pane droit (§3). Non-régression #579.
 *
 * Contexte régression #579 : ouvert via le bouton carte, le chat s'affichait en
 * FLOTTANT qui RECOUVRAIT le pane droit ET son propre déclencheur (donc re-clic =
 * ne ferme pas / « coincé ouvert »). Le fix hôte FORCE le mode ANCRÉ sur la vue
 * carte : App.svelte réserve alors `padding-right: dockWidthCss` ⇒ le chat coexiste
 * avec le pane droit (poussé, jamais recouvert) et le bouton reste atteignable.
 *
 * ⚠ CONDITION DE RÉGRESSION reproduite : on PERSISTE la préférence `floating`
 * (`chatWidgetDisplayMode=floating`) AVANT le chargement. Sans le fix, le chat
 * s'ouvrirait en flottant (superposé) ⇒ les assertions (a)/(b) échouent. Avec le
 * fix, la vue carte force l'ancré ⇒ coexistence + re-clic-ferme.
 *
 * 5 ASSERTIONS :
 *   (c) le bouton carré `chat-toggle` OUVRE le chat (« Fermer le chat » visible) ;
 *   (d) la bulle ronde globale `chat-bubble-trigger` est ABSENTE sur la carte ;
 *   (a) [NOUVEAU] après ouverture, le PANE DROIT `signaux-sel-panel` est visible
 *       ET cliquable (pas recouvert) ;
 *   (b) [NOUVEAU] re-clic sur `chat-toggle` → chat FERMÉ (aria-expanded=false,
 *       « Fermer le chat » absent) ;
 *   (e) HORS carte, la bulle ronde globale REVIENT (carte démontée).
 *
 * App authentifiée mockée (aucun docker/backend) ; le socle carto + le pane droit
 * + le bouton chat sont montés au niveau RÉGION (aucune ville à sélectionner).
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
    },
  ],
};

async function mockSignauxApi(page: Page): Promise<void> {
  await mockAuthenticated(page);
  await page.route("**/api/graph-signals/by-city", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(BY_CITY_RESPONSE),
    }),
  );
  await page.route(`**/api/geo/${CITY_SLUG}/zones**`, (route: Route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not found" }),
    }),
  );
}

/** Reproduit la CONDITION #579 : préférence chat FLOTTANT persistée. */
async function persistFloatingPreference(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("chatWidgetDisplayMode", "floating");
    } catch {
      /* localStorage indisponible : le défaut « docked » couvre alors le cas. */
    }
  });
}

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("chat rangée carte — coexistence pane droit (fix #579)", () => {
  test("(c)(d)(a) le bouton ouvre le chat ; bulle absente ; pane droit visible ET cliquable", async ({
    page,
  }) => {
    await mockSignauxApi(page);
    await persistFloatingPreference(page);
    await page.goto("/#/signaux");

    await expect(page.getByTestId("geo-city-map-base")).toBeVisible();

    const chatToggle = page.getByTestId("chat-toggle");
    await expect(chatToggle).toBeVisible();
    await expect(chatToggle).toHaveAttribute("aria-expanded", "false");

    // (d) bulle ronde globale MASQUÉE sur la carte (déclencheur unique = le carré).
    await expect(page.getByTestId("chat-bubble-trigger")).toHaveCount(0);

    // (c) le bouton OUVRE réellement le chat.
    await chatToggle.click();
    await expect(page.getByRole("button", { name: "Fermer le chat" })).toBeVisible();
    await expect(chatToggle).toHaveAttribute("aria-expanded", "true");

    // (a) [NOUVEAU] le pane droit reste VISIBLE et CLIQUABLE (non recouvert par le
    // chat). Le `trial` vérifie l'actionnabilité (pas d'overlay interceptant les
    // événements) SANS déclencher d'effet de bord sur le pane.
    const pane = page.getByTestId("signaux-sel-panel");
    await expect(pane).toBeVisible();
    await pane.click({ trial: true });
  });

  test("(b) re-clic sur le bouton carré → chat FERMÉ (pas coincé ouvert)", async ({
    page,
  }) => {
    await mockSignauxApi(page);
    await persistFloatingPreference(page);
    await page.goto("/#/signaux");

    await expect(page.getByTestId("geo-city-map-base")).toBeVisible();
    const chatToggle = page.getByTestId("chat-toggle");

    // Ouverture.
    await chatToggle.click();
    await expect(page.getByRole("button", { name: "Fermer le chat" })).toBeVisible();
    await expect(chatToggle).toHaveAttribute("aria-expanded", "true");

    // Re-clic (le bouton est atteignable : le chat ne le recouvre pas) → FERMÉ.
    await chatToggle.click();
    await expect(page.getByRole("button", { name: "Fermer le chat" })).toHaveCount(0);
    await expect(chatToggle).toHaveAttribute("aria-expanded", "false");
  });

  test("(e) hors carte : la bulle ronde globale revient (carte démontée)", async ({
    page,
  }) => {
    await mockSignauxApi(page);
    await persistFloatingPreference(page);
    await page.goto("/#/signaux");

    await expect(page.getByTestId("geo-city-map-base")).toBeVisible();
    await expect(page.getByTestId("chat-bubble-trigger")).toHaveCount(0);

    // Navigation hors carte (Kanban = aucune carte) → SignauxMapView démonté →
    // suppression #564 relâchée.
    await page.goto("/#/kanban");
    await expect(page.getByTestId("geo-city-map-base")).toHaveCount(0);
    await expect(page.getByTestId("chat-toggle")).toHaveCount(0);
    await expect(page.getByTestId("chat-bubble-trigger")).toBeVisible();
  });
});
