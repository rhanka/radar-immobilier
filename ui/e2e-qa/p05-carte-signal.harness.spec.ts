import { expect, test } from "@playwright/test";

/**
 * P05 — PREUVE DE RENDU de la CARTE SIGNAL (liste Signaux, pane droit).
 *
 * Cible owner : chaque carte = [TITRE du signal] + [BULLE d'ÉTAPE compacte],
 * SANS pavé « highlight » (signal-rank-row), SANS badge « Effet densifiant ».
 *
 * Le harnais `sel-panel.html?fixture=etape` monte SignauxSelPanel EN ISOLATION
 * avec deux signaux dont l'étape provient de deux sources distinctes :
 *   - classification vivier v2 posée   → « Rezonage, avis de motion » ;
 *   - hors vivier v2 (props.etape/instr) → « PPCMOI, consultation publique ».
 *
 * Pilotage par variables d'environnement (pour capturer AVANT/APRÈS) :
 *   - P05_QUERY : query string (défaut « ?fixture=etape ») ;
 *   - P05_SHOT  : chemin PNG de sortie (défaut …/p05-carte-signal-apres.png).
 */

const SHOT = process.env.P05_SHOT ?? "test-results/p05-carte-signal-apres.png";
const QUERY = process.env.P05_QUERY ?? "?fixture=etape";
const HARNESS = `/e2e-qa/harness/sel-panel.html${QUERY}`;

test.describe("P05 — carte signal : titre + bulle d'étape", () => {
  test("capture le rendu de la liste des signaux", async ({ page }) => {
    await page.setViewportSize({ width: 460, height: 720 });
    await page.goto(HARNESS);

    // Déplie l'accordéon « Signaux » puis attend la 1re ligne de signal.
    await page.locator("summary", { hasText: "Signaux" }).click();
    await expect(page.locator(".sel-entity-label").first()).toBeVisible({
      timeout: 10_000,
    });

    await page.screenshot({ path: SHOT });
  });

  test("invariants P05 (nouveau rendu) : bulle présente, effet densifiant absent", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 460, height: 720 });
    await page.goto(HARNESS);
    await page.locator("summary", { hasText: "Signaux" }).click();
    await expect(page.locator(".sel-entity-label").first()).toBeVisible({
      timeout: 10_000,
    });

    // La bulle d'étape porte la forme validée « Instrument, étape ».
    await expect(
      page.locator('[data-testid="signal-stage-badge"]').first(),
    ).toContainText("Rezonage, avis de motion");
    await expect(page.locator('[data-testid="signal-stage-badge"]')).toHaveCount(2);
    await expect(page.getByText("PPCMOI, consultation publique")).toBeVisible();

    // Retrait RÉEL : ni pavé highlight, ni badge « Effet densifiant ».
    await expect(page.locator(".signal-rank-row")).toHaveCount(0);
    await expect(page.getByText("Effet densifiant")).toHaveCount(0);
  });
});
