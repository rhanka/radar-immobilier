import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — Bug #5 (rendu PDF Preuve).
 *
 * On monte SignalPdfOverlay isolé et on vérifie le pipeline pdf.js RÉEL :
 * worker bundlé par Vite (?url), getDocument sur /api/documents/raw (mocké
 * avec un VRAI PDF), rendu canvas. Le succès = le canvas est peint
 * (.pdf-canvas-scroll visible, pas le bloc d'erreur .pdf-missing).
 *
 * Ce test PROUVE que le câblage UI + worker pdf.js fonctionnent. Si l'API
 * renvoie bien le binaire, la preuve se rend.
 *
 * Le blocage prod résiduel (« fallback Mont-Tremblant / St-Frédéric ») n'était
 * PAS une donnée absente : les PV existent sur SCW radar-immobilier-docs-pocs
 * (raw/proces-verbaux-<ville>/cas/<sha>.pdf) et la route /api/documents/raw les
 * sert en 200 application/pdf. La cause : les nœuds graphify portent aussi un
 * sourceUrl PUBLIC (PDF de la ville) que l'overlay préférait pour le RENDU →
 * pdf.js tentait un fetch cross-origin bloqué par CORS. Le rendu passe désormais
 * par la route interne same-origin (test « préfère la route interne » ci-dessous).
 */

const pdfFixture = readFileSync(
  fileURLToPath(new URL("./fixtures/preuve-qa.pdf", import.meta.url)),
);

const HARNESS = "/e2e-qa/harness/pdf-overlay.html";

test.describe("SignalPdfOverlay — rendu pdf.js (navigateur)", () => {
  test("rend le PDF dans le canvas quand /api/documents/raw renvoie un binaire PDF", async ({
    page,
  }) => {
    // Capture la requête réelle vers la route de streaming interne : prouve que
    // le câblage rawRef -> /api/documents/raw?rawRef=... est correct.
    const rawRequest = page.waitForRequest("**/api/documents/raw*", {
      timeout: 15_000,
    });
    await page.route("**/api/documents/raw*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: pdfFixture,
      }),
    );

    await page.goto(`${HARNESS}?rawRef=raw/qa/preuve.pdf`);

    // L'URL de streaming interne a bien été appelée (câblage rawRef -> /api).
    const req = await rawRequest;
    expect(decodeURIComponent(req.url())).toContain(
      "/api/documents/raw?rawRef=raw/qa/preuve.pdf",
    );

    // Le viewer doit afficher la zone canvas (pipeline OK), PAS le bloc d'erreur.
    const canvasScroll = page.locator(".pdf-canvas-scroll");
    await expect(canvasScroll).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".pdf-missing")).toHaveCount(0);

    // Le canvas a réellement été peint par pdf.js (dimensions du MediaBox du PDF
    // fixture = 300x200 → preuve que le worker a décodé et rendu la page).
    const canvasBox = await page
      .locator(".pdf-canvas-stage canvas")
      .boundingBox();
    expect(canvasBox?.width ?? 0).toBeGreaterThan(0);
    expect(canvasBox?.height ?? 0).toBeGreaterThan(0);
  });

  test("préfère la route interne /api/documents/raw au sourceUrl public cross-origin (CORS)", async ({
    page,
  }) => {
    // Régression du fallback prod : les nœuds graphify portent À LA FOIS un
    // sourceUrl public (PDF de la ville, ex. https://vdmt.ca/…/PV.pdf) ET un
    // rawRef. L'ancien code préférait sourceUrl → pdf.js tentait un fetch
    // cross-origin que le navigateur BLOQUE (la ville ne renvoie aucun en-tête
    // CORS) → « preuve non rendue ». Le rendu DOIT passer par la route interne
    // same-origin /api/documents/raw, qui sert les octets depuis le bucket.
    const crossOriginPdf =
      "https://ville-externe.example.test/storage/PV-2026.pdf";

    // Si pdf.js tentait le sourceUrl public, cette route serait sollicitée (et,
    // en vrai navigateur, échouerait sur CORS). On la mappe pour DÉTECTER toute
    // tentative — le test échoue alors via l'assert "0 hit" plus bas.
    let crossOriginHits = 0;
    await page.route(`${crossOriginPdf}*`, (route) => {
      crossOriginHits += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: pdfFixture,
      });
    });

    const rawRequest = page.waitForRequest("**/api/documents/raw*", {
      timeout: 15_000,
    });
    await page.route("**/api/documents/raw*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: pdfFixture,
      }),
    );

    // BOTH props présents (cas prod) : sourceUrl public + rawRef interne.
    await page.goto(
      `${HARNESS}?rawRef=raw/qa/preuve.pdf&sourceUrl=${encodeURIComponent(
        crossOriginPdf,
      )}`,
    );

    // Le rendu pdf.js a sollicité la route INTERNE, pas l'URL publique.
    const req = await rawRequest;
    expect(decodeURIComponent(req.url())).toContain(
      "/api/documents/raw?rawRef=raw/qa/preuve.pdf",
    );

    // Le canvas est peint (pipeline OK), aucun bloc d'erreur.
    await expect(page.locator(".pdf-canvas-scroll")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".pdf-missing")).toHaveCount(0);

    // L'URL publique cross-origin n'a JAMAIS été chargée par le viewer.
    expect(crossOriginHits).toBe(0);
  });

  test("affiche le bloc d'erreur si l'API ne fournit pas le PDF (404)", async ({
    page,
  }) => {
    await page.route("**/api/documents/raw*", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "document_not_found" }),
      }),
    );

    await page.goto(`${HARNESS}?rawRef=raw/qa/absent.pdf`);

    // Échec attendu = bloc .pdf-missing (preuve absente du bucket), PAS un crash.
    await expect(page.locator(".pdf-missing")).toBeVisible({ timeout: 15_000 });
  });
});
