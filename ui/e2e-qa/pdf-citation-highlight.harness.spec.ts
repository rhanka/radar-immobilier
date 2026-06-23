import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * QA NAVIGATEUR — LOT 1 viewer de preuve (bugs #81/#82/#83/#85).
 *
 * On monte SignalPdfOverlay isolé sur un PDF 3 pages à couche texte RÉELLE
 * (preuve-qa-multipage.pdf : page 2 = page cible portant la citation, pages 1/3
 * portant une amorce générique « ATTENDU QUE la municipalite » partagée). La
 * QA prouve par capture + assertions géométriques que :
 *   #82 le surlignage est DIMENSIONNÉ à l'échelle (collé au texte) à 100 % ET à
 *       un zoom ≠ 100 % — pas seulement positionné ;
 *   #83 SEULE la page cible (page 2) est surlignée ; les pages 1/3 (même amorce)
 *       n'ont AUCUN surlignage parasite ;
 *   #81 l'ouverture est lisible (fit-width : le canvas remplit la largeur dispo)
 *       et centrée sur le passage surligné (scroll auto) ;
 *   #85 le zoom molette (Ctrl+molette) et les contrôles toolbar (−/+ et %)
 *       fonctionnent (le % change, le canvas est re-rendu).
 */

const pdfFixture = readFileSync(
  fileURLToPath(new URL("./fixtures/preuve-qa-multipage.pdf", import.meta.url)),
);

const HARNESS = "/e2e-qa/harness/pdf-overlay.html";
const SHOT_DIR = "/tmp";

// Citation spécifique présente UNIQUEMENT en page 2 (cf. fixture).
const EXCERPT =
  "Le conseil adopte le reglement numero 2026-42 sur la densification residentielle du secteur nord";

async function mockPdf(page: Page): Promise<void> {
  await page.route("**/api/documents/raw*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: pdfFixture,
    }),
  );
}

/** Rectangles des marques de surlignage relatifs au canvas rendu. */
async function highlightRects(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(".pdf-canvas-stage canvas");
    const cRect = canvas?.getBoundingClientRect();
    const marks = Array.from(document.querySelectorAll(".pdf-text-layer .pdf-hl"));
    return {
      canvas: cRect
        ? { width: cRect.width, height: cRect.height }
        : null,
      marks: marks.map((m) => {
        const r = m.getBoundingClientRect();
        const c = cRect ?? { left: 0, top: 0, width: 1, height: 1 };
        return {
          // position et taille en FRACTION du canvas (indépendant du zoom)
          xFrac: (r.left - c.left) / c.width,
          yFrac: (r.top - c.top) / c.height,
          wFrac: r.width / c.width,
          hFrac: r.height / c.height,
          h: r.height,
        };
      }),
    };
  });
}

async function openOnTarget(page: Page, targetPage = 2): Promise<void> {
  await mockPdf(page);
  await page.goto(
    `${HARNESS}?rawRef=raw/qa/pv.pdf&page=${targetPage}&excerpt=${encodeURIComponent(
      EXCERPT,
    )}`,
  );
  await expect(page.locator(".pdf-canvas-scroll")).toBeVisible({ timeout: 15_000 });
  // attendre la première marque de surlignage (page cible)
  await expect(page.locator(".pdf-text-layer .pdf-hl").first()).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("SignalPdfOverlay — surlignage citation (LOT 1)", () => {
  test("#81 ouverture fit-width lisible + centrée sur le surlignage", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openOnTarget(page);

    // fit-width : le canvas occupe une large part de la largeur du scroller.
    const fit = await page.evaluate(() => {
      const scroll = document.querySelector(".pdf-canvas-scroll");
      const canvas = document.querySelector(".pdf-canvas-stage canvas");
      if (!scroll || !canvas) return null;
      return {
        scrollW: scroll.clientWidth,
        canvasW: (canvas as HTMLCanvasElement).getBoundingClientRect().width,
        scrollTop: scroll.scrollTop,
      };
    });
    expect(fit).not.toBeNull();
    // canvas remplit >= 80% de la largeur dispo (lisible, pas réduit) (#81).
    expect(fit!.canvasW / fit!.scrollW).toBeGreaterThan(0.8);

    // le % toolbar affiche bien le fit-width courant (pas figé à 100%).
    const pct = await page.locator(".pdf-zoom-level").textContent();
    expect(pct).toMatch(/\d+%/);

    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-81-fitwidth-centered.png` });
  });

  test("#82 surlignage aligné au texte à 100% ET à un zoom différent", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openOnTarget(page);

    // --- À l'échelle d'ouverture (fit-width) : relevé des fractions. ---
    const a = await highlightRects(page);
    expect(a.marks.length).toBeGreaterThan(0);
    // Le surlignage est dans les bornes du canvas (collé au document).
    for (const m of a.marks) {
      expect(m.xFrac).toBeGreaterThanOrEqual(-0.02);
      expect(m.xFrac + m.wFrac).toBeLessThanOrEqual(1.02);
      expect(m.yFrac).toBeGreaterThanOrEqual(-0.02);
      expect(m.yFrac + m.hFrac).toBeLessThanOrEqual(1.02);
      // hauteur de marque réaliste pour du 12pt (ni écrasée, ni géante).
      expect(m.hFrac).toBeGreaterThan(0.005);
      expect(m.hFrac).toBeLessThan(0.08);
    }
    // La citation (y≈620 sur 842 → ~26% depuis le haut) tombe dans le tiers
    // supérieur-central : preuve d'un positionnement vertical correct.
    const firstY = Math.min(...a.marks.map((m) => m.yFrac));
    expect(firstY).toBeGreaterThan(0.15);
    expect(firstY).toBeLessThan(0.5);
    const readPct = async () =>
      Number.parseInt(
        (await page.locator(".pdf-zoom-level").textContent())?.replace("%", "") ??
          "0",
        10,
      );
    const startPct = await readPct();
    const hPxStart = a.marks[0]!.h;
    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-82-align-100.png` });

    // --- Change l'échelle d'au moins +40% via la toolbar puis re-relève. ---
    // En fit-width l'ouverture peut déjà être très zoomée (A4 dans un large
    // panneau). On force une échelle NETTEMENT différente en cliquant « + »
    // (ou « − » si déjà près du max) jusqu'à un delta franc.
    const plus = page.getByRole("button", { name: "Zoomer", exact: true });
    const minus = page.getByRole("button", { name: "Dézoomer", exact: true });
    const goUp = startPct < 250; // marge sous le clamp max (400%)
    for (let i = 0; i < 8; i++) {
      const pct = await readPct();
      const delta = Math.abs(pct - startPct) / startPct;
      if (delta >= 0.4) break;
      await (goUp ? plus : minus).click();
      await page.waitForTimeout(120);
    }
    const zoomPct = await readPct();
    // Le % a réellement changé (re-render à l'échelle, #85).
    expect(zoomPct).not.toBe(startPct);

    await expect(page.locator(".pdf-text-layer .pdf-hl").first()).toBeVisible();
    const b = await highlightRects(page);
    const hPxZoom = b.marks[0]!.h;

    // #82 CŒUR : la HAUTEUR pixel de la marque SUIT l'échelle. Le ratio des
    // hauteurs ≈ ratio des % (les dimensions sont mises à l'échelle, pas
    // seulement la position). Avant le fix, fontHeight restait en espace
    // scale-1 → hauteur quasi constante quel que soit le zoom.
    const expectedRatio = zoomPct / startPct;
    const actualRatio = hPxZoom / hPxStart;
    expect(actualRatio).toBeGreaterThan(expectedRatio * 0.85);
    expect(actualRatio).toBeLessThan(expectedRatio * 1.15);

    // ET le surlignage reste positionné sur le texte (même fraction Y, à
    // l'épsilon près) : il n'a pas dérivé en changeant l'échelle.
    const firstYZoom = Math.min(...b.marks.map((m) => m.yFrac));
    expect(Math.abs(firstYZoom - firstY)).toBeLessThan(0.05);

    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-82-align-zoom.png` });
  });

  test("#83 seule la page cible est surlignée — aucune marque parasite ailleurs", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openOnTarget(page, 2);

    // Page 2 (cible) : au moins une marque.
    await expect(page.locator(".pdf-text-layer .pdf-hl").first()).toBeVisible();
    const onTarget = await page.locator(".pdf-text-layer .pdf-hl").count();
    expect(onTarget).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-83-target-page2.png` });

    // Va en page 1 (amorce générique « ATTENDU QUE la municipalite » partagée) :
    // ZÉRO surlignage (le garde de page + matcher durci l'interdisent).
    await page.getByRole("button", { name: "Page précédente" }).click();
    await expect(page.locator(".pdf-overlay-meta")).toContainText("Page 1");
    await page.waitForTimeout(300);
    expect(await page.locator(".pdf-text-layer .pdf-hl").count()).toBe(0);
    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-83-other-page1-clean.png` });

    // Va en page 3 (même amorce) : ZÉRO surlignage également.
    await page.getByRole("button", { name: "Page suivante" }).click();
    await page.getByRole("button", { name: "Page suivante" }).click();
    await expect(page.locator(".pdf-overlay-meta")).toContainText("Page 3");
    await page.waitForTimeout(300);
    expect(await page.locator(".pdf-text-layer .pdf-hl").count()).toBe(0);
    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-83-other-page3-clean.png` });
  });

  test("#85 zoom molette (Ctrl) et contrôles toolbar font varier le %", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openOnTarget(page);

    const readPct = async () =>
      Number.parseInt(
        (await page.locator(".pdf-zoom-level").textContent())?.replace("%", "") ??
          "0",
        10,
      );

    const start = await readPct();

    // --- Bouton + ---
    await page.getByRole("button", { name: "Zoomer", exact: true }).click();
    await page.waitForTimeout(120);
    const afterPlus = await readPct();
    expect(afterPlus).toBeGreaterThan(start);

    // --- Bouton − ---
    await page.getByRole("button", { name: "Dézoomer", exact: true }).click();
    await page.waitForTimeout(120);
    const afterMinus = await readPct();
    expect(afterMinus).toBeLessThan(afterPlus);

    // --- Molette Ctrl (zoom in) ---
    const box = await page.locator(".pdf-canvas-scroll").boundingBox();
    await page.keyboard.down("Control");
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -240);
    await page.keyboard.up("Control");
    await page.waitForTimeout(200);
    const afterWheel = await readPct();
    expect(afterWheel).toBeGreaterThan(afterMinus);

    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-85-zoom-controls.png` });

    // --- Clic sur le % : retour fit-width ---
    await page.locator(".pdf-zoom-level").click();
    await page.waitForTimeout(150);
    const afterReset = await readPct();
    expect(afterReset).not.toBe(afterWheel);
  });
});
