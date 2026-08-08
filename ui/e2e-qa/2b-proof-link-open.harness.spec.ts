import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — #2b : une preuve PUBLIQUE re-autorisée (object-storage public
 * type VPlus) rendue dans la fiche signal est CLIQUABLE et OUVRE réellement
 * (nouvel onglet, 200) ; un cas ARCHIVE (rawRef) ouvre le proxy same-origin
 * /api/documents/raw. On prouve le COMPORTEMENT clic→ouverture en vrai Chromium
 * (headless jetable, aucun docker) via le harnais sel-panel. La cible réseau est
 * STUBBÉE 200 (le test ne dépend pas du réseau externe), donc on prouve le
 * câblage clic→navigation, pas la vivacité live (mesurée à part).
 */

const HARNESS = "/e2e-qa/harness/sel-panel.html";
const PUBLIC_PROOF_URL =
  "https://vplus-documents.s3.ca-central-1.amazonaws.com/batiscan/_publication/fichiers/pv.pdf";

test.describe("#2b — preuve cliquable ouvre (comportement rendu)", () => {
  test("lien direct PUBLIC (VPlus) rendu + clic → nouvel onglet ouvre 200", async ({
    page,
    context,
  }) => {
    // Stub la cible publique → 200 PDF (câblage clic→ouverture, pas le réseau réel).
    await context.route(PUBLIC_PROOF_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>preuve VPlus (mock 200)</body></html>",
      }),
    );
    await page.goto(`${HARNESS}?proof=public`);

    const link = page.getByTestId("signal-proof-direct-link");
    await expect(link).toBeVisible({ timeout: 10_000 });
    await expect(link).toHaveAttribute("href", PUBLIC_PROOF_URL);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);

    // Clic → nouvel onglet (target=_blank) qui OUVRE l'URL publique (mock 200).
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      link.click(),
    ]);
    // Le popup navigue vers l'URL publique (mock 200). Poll sur l'URL : robuste
    // même pour un PDF (viewer natif, pas de domcontentloaded).
    await expect.poll(() => popup.url(), { timeout: 10_000 }).toBe(PUBLIC_PROOF_URL);
  });

  test("cas ARCHIVE (rawRef) : lien same-origin /api/documents/raw rendu + clic → ouvre 200", async ({
    page,
    context,
  }) => {
    // Stub le proxy d'archive same-origin → 200 PDF (jamais une URL S3 signée).
    await context.route("**/api/documents/raw*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>archive proxy (mock 200)</body></html>",
      }),
    );
    // Défaut du harnais : rawRef présent, aucune sourceUrl → lien ARCHIVE.
    await page.goto(HARNESS);

    const archive = page.getByTestId("signal-proof-archive-link");
    await expect(archive).toBeVisible({ timeout: 10_000 });
    await expect(archive).toHaveAttribute("href", /\/api\/documents\/raw\?rawRef=/);

    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      archive.click(),
    ]);
    await expect
      .poll(() => popup.url(), { timeout: 10_000 })
      .toContain("/api/documents/raw?rawRef=");
  });
});
