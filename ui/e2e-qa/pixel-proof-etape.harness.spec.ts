import { expect, test } from "@playwright/test";

/**
 * PREUVE DU CHEMIN DE RENDU (RENDER) — v3.4 etape/instrument.
 *
 * Documente le 3e maillon de la preuve d'abouti v3.4 (DATA écrite + SERVING
 * direct côté API = preuve code infra ; RENDER = ici). On rend le composant
 * réel SignauxSelPanel en vue B (headless jetable, donnée de TEST) et on prouve
 * que la ligne « Instrument, étape » est RENDUE, puis on capture l'écran.
 *
 * HONNÊTETÉ : ce n'est PAS une capture de la prod servie-live (le propriétaire
 * n'a pas partagé de session ; le refus de faker/piloter le Chrome live est
 * assumé). Le bandeau incrusté l'étiquette explicitement.
 */
const HARNESS = "/e2e-qa/harness/sel-panel.html?b=1";

test.describe("v3.4 RENDER — SignauxSelPanel rend « Étape + instrument »", () => {
  test("la ligne instrument/étape est rendue + capture d'écran", async ({ page }) => {
    await page.goto(HARNESS);

    // Bandeau d'étiquette honnête présent (donnée test, pas servi-live).
    await expect(page.getByTestId("render-proof-banner")).toBeVisible();

    // Le CHEMIN DE RENDU etape/instrument produit bien la ligne métier neutre.
    await expect(
      page.getByText("Refonte, projet de règlement", { exact: false }),
    ).toBeVisible();

    // Capture d'écran (livrable de preuve pixel).
    await page.screenshot({
      path: "e2e-qa/__screenshots__/v3.4-render-etape-instrument-westmount.png",
      fullPage: true,
    });
  });
});
