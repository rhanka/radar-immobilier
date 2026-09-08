import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — CHAT DÉSACTIVÉ (décision owner 2026-09-07,
 * `DECISION_CHAT_DISABLE_STACK_LLMMESH_2026-09-07.md`).
 *
 * Le chat carte (Lot 2) est GARDÉ dans le code mais GATÉ derrière un feature-flag
 * DÉFAUT OFF (`VITE_CHAT_ENABLED`). Ce spec verrouille l'état DÉSACTIVÉ : sur la
 * vue Signaux comme hors carte, AUCUN affordance chat n'est rendu — ni le bouton
 * carré de la rangée (`chat-toggle`), ni la bulle ronde globale
 * (`chat-bubble-trigger`), ni le dialog. Réversible : flag ON ⇒ le chat revient
 * (couvert par chat-row-coexist.spec.ts, qui tourne alors).
 *
 * Ce spec est SIGNIFICATIF quand le build e2e est OFF (le défaut). Si le build est
 * bâti avec le flag ON, il est SKIP (le chat est légitimement présent).
 *
 * App authentifiée mockée (aucun docker/backend) : le socle carto + le pane droit
 * montent au niveau RÉGION (aucune ville à sélectionner).
 */

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

test.use({ viewport: { width: 1600, height: 900 } });

test.describe("chat DÉSACTIVÉ (flag OFF, défaut) — aucun affordance chat", () => {
  test.skip(CHAT_ENABLED, "flag chat ON : le chat est légitimement présent (voir chat-row-coexist)");

  test("(carte) le bouton carré ET la bulle ronde sont ABSENTS ; aucun dialog", async ({
    page,
  }) => {
    await mockSignauxApi(page);
    await page.goto("/#/signaux");

    // Le socle carto monte (donc l'absence du chat n'est pas un simple non-rendu
    // de la vue) : la rangée de contrôles est là, sans le déclencheur chat.
    await expect(page.getByTestId("geo-city-map-base")).toBeVisible();

    await expect(page.getByTestId("chat-toggle")).toHaveCount(0);
    await expect(page.getByTestId("chat-bubble-trigger")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Assistant radar" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Fermer le chat" })).toHaveCount(0);
  });

  test("(hors carte) la bulle ronde globale reste ABSENTE (host non monté)", async ({
    page,
  }) => {
    await mockSignauxApi(page);
    await page.goto("/#/kanban");

    // Hors de la vue carte, où la bulle ronde REVIENDRAIT si le chat était actif.
    await expect(page.getByTestId("geo-city-map-base")).toHaveCount(0);
    await expect(page.getByTestId("chat-bubble-trigger")).toHaveCount(0);
    await expect(page.getByTestId("chat-toggle")).toHaveCount(0);
  });
});
