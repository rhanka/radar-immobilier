import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — #94 : affichage HONNÊTE quand la preuve est indisponible.
 *
 * On distingue deux situations, qui ne doivent JAMAIS se réduire à un bouton
 * mort (rond barré) silencieux ni à un cadre vide :
 *
 *   (a) preuve NON DISPONIBLE — aucune source documentaire n'est reliée au
 *       signal (ni rawRef, ni sourceUrl, ni sourceRef). Le panneau de droite
 *       (SignauxSelPanel) affiche un encart explicite « Preuve non disponible »
 *       À LA PLACE du bouton « Voir la preuve ». Aucun bouton désactivé muet.
 *
 *   (b) PROBLÈME TEMPORAIRE — un document est attendu (rawRef présent) mais le
 *       fetch/render échoue (ici /api/documents/raw renvoie 500). L'overlay
 *       (SignalPdfOverlay) montre « Problème temporaire de chargement » + un
 *       bouton RÉESSAYER (qui refait un vrai fetch) et le lien « Ouvrir »
 *       externe si une sourceUrl est fournie.
 *
 * Harnais de COMPOSANTS ISOLÉS : aucun stack docker, /api mocké par Playwright.
 */

const SHOT_DIR = "/tmp";
const SEL_PANEL = "/e2e-qa/harness/sel-panel.html";
const PDF_OVERLAY = "/e2e-qa/harness/pdf-overlay.html";

test.describe("#94 — affichage honnête preuve indisponible", () => {
  test("(a) signal SANS source → encart « preuve non disponible » (pas de bouton mort)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 460, height: 820 });
    // ?evidence=none : les signaux du harnais n'ont AUCUNE source documentaire.
    await page.goto(`${SEL_PANEL}?evidence=none`);

    // Parcours utilisateur : déplie « Signaux », ouvre la fiche du 1er signal.
    await page.locator("summary", { hasText: "Signaux" }).click();
    await page.locator(".sel-entity-label", { hasText: "A16" }).first().click();

    // L'encart honnête est affiché À LA PLACE du bouton « Voir la preuve ».
    const unavailable = page.locator(".evidence-unavailable");
    await expect(unavailable).toBeVisible({ timeout: 10_000 });
    await expect(unavailable).toContainText("Preuve non disponible");
    await expect(unavailable).toContainText(
      "aucune source documentaire reliée à ce signal",
    );

    // Garde-fou : PAS de bouton « Voir la preuve » (ni actif ni désactivé muet).
    await expect(page.locator(".doc-ref-button")).toHaveCount(0);

    await page.screenshot({ path: `${SHOT_DIR}/pdf-honest-a-no-source.png` });
  });

  test("(b) doc attendu mais erreur → message temporaire + bouton Réessayer", async ({
    page,
  }) => {
    // La route interne échoue (500) : le pipeline pdf.js lèvera loadError.
    let calls = 0;
    await page.route("**/api/documents/raw*", (route) => {
      calls += 1;
      return route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "boom",
      });
    });

    // rawRef présent (doc attendu) + sourceUrl public pour le lien « Ouvrir ».
    const sourceUrl = "https://ville.example/pv.pdf";
    await page.goto(
      `${PDF_OVERLAY}?rawRef=raw/qa/attendu.pdf&sourceUrl=${encodeURIComponent(
        sourceUrl,
      )}`,
    );

    // Le bloc « problème temporaire » s'affiche (role=alert), PAS le cadre vide.
    const missing = page.locator(".pdf-missing");
    await expect(missing).toBeVisible({ timeout: 15_000 });
    await expect(missing).toContainText("Problème temporaire de chargement");

    // Bouton RÉESSAYER présent + lien « Ouvrir » externe (sourceUrl fourni).
    const retry = page.locator(".pdf-missing-retry");
    await expect(retry).toBeVisible();
    await expect(page.locator(".pdf-missing a")).toHaveAttribute("href", sourceUrl);

    await page.screenshot({ path: `${SHOT_DIR}/pdf-honest-b-temporary.png` });

    // RÉESSAYER refait un vrai fetch (l'entrée fautive a été purgée du cache).
    const callsBefore = calls;
    await retry.click();
    await expect
      .poll(() => calls, { timeout: 10_000 })
      .toBeGreaterThan(callsBefore);
  });
});
