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

// Feature-flag chat (décision owner 2026-09-07) : DÉFAUT OFF. Ces specs vérifient
// le comportement ACTIVÉ (déclencheur + coexistence pane droit) → elles ne sont
// SIGNIFICATIVES que quand le chat est bâti ON. On les GATE sur le flag du build
// e2e (`VITE_CHAT_ENABLED`, lu côté runner) : ON ⇒ elles tournent (vertes) ; OFF
// (défaut) ⇒ SKIP (jamais rouge). L'état DÉSACTIVÉ est couvert par chat-disabled.spec.ts.
const CHAT_ENABLED = process.env.VITE_CHAT_ENABLED === "true";

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
  test.skip(!CHAT_ENABLED, "chat désactivé par défaut (flag OFF) — décision owner 2026-09-07");
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

/**
 * §5 R3 P2 — COEXISTENCE MOBILE du CLUSTER de contrôles carte avec le chat.
 *
 * En mobile (≤639px), chat-ui force le mode DOCKED et publie `dockWidthCss:"100vw"` :
 * le dock rend alors un overlay PLEIN-ÉCRAN (`fixed inset z-50`, width 100vw) et
 * App.svelte réservait `padding-right:100vw` (⇒ largeur de contenu 0, carte écrasée).
 * Résultat AVANT-fix : ouvert via le bouton carré de la rangée, le chat RECOUVRE et
 * pousse HORS-ÉCRAN le cluster (Layers + mesure + chat-toggle) → non-cliquable, donc
 * plus moyen de changer de fond NI de refermer le chat via son déclencheur.
 *
 * Le rework #579 ne traitait QUE le pane droit (desktop, via `padding-right`). Ce
 * test verrouille la coexistence du CLUSTER en mobile : le fix host (App.svelte ne
 * réserve pas 100vw + z-index du cluster au-dessus du chat) le garde VISIBLE +
 * CLIQUABLE au-dessus de l'overlay plein-écran.
 */
test.describe("chat rangée carte — coexistence MOBILE du cluster (Layers) avec le chat docked (§5 R3 P2)", () => {
  test.skip(!CHAT_ENABLED, "chat désactivé par défaut (flag OFF) — décision owner 2026-09-07");
  test.use({ viewport: { width: 390, height: 844 } });

  test("(P2) chat ouvert via le bouton carte → cluster Layers VISIBLE + CLIQUABLE (non recouvert par le chat plein-écran)", async ({
    page,
  }) => {
    await mockSignauxApi(page);
    await persistFloatingPreference(page);
    await page.goto("/#/signaux");

    await expect(page.getByTestId("geo-city-map-base")).toBeVisible();

    const chatToggle = page.getByTestId("chat-toggle");
    // Host e2e 127.0.0.1 ∈ allowlist satellite ⇒ le trigger `Layers` du socle est rendu.
    const mapLayers = page.getByTestId("map-layers-toggle");

    await expect(chatToggle).toBeVisible();
    await expect(chatToggle).toHaveAttribute("aria-expanded", "false");
    // Cluster présent ET cliquable AVANT ouverture (état de référence).
    await expect(mapLayers).toBeVisible();
    await mapLayers.click({ trial: true });

    // Ouverture via le bouton carré de la rangée → chat docked MOBILE plein-écran.
    await chatToggle.click();
    await expect(page.getByRole("button", { name: "Fermer le chat" })).toBeVisible();
    await expect(chatToggle).toHaveAttribute("aria-expanded", "true");

    // GATE P2 — chat plein-écran OUVERT : le cluster reste VISIBLE + CLIQUABLE
    // (au-dessus de l'overlay z-50, dans l'emprise du viewport). `trial` prouve
    // l'actionnabilité (pas d'interception par l'overlay chat, pas hors-écran) SANS
    // ouvrir le menu de fond. AVANT le fix host : recouvert/hors-champ → échec.
    await expect(mapLayers).toBeVisible();
    await mapLayers.click({ trial: true });
    // Le bouton chat lui-même (dernier enfant du cluster) reste atteignable → le
    // re-clic pour FERMER reste possible (pas de « chat coincé ouvert » en mobile).
    await expect(chatToggle).toBeVisible();
    await chatToggle.click({ trial: true });
  });
});
