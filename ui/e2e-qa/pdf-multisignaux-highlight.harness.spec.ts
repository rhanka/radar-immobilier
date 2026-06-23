import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * QA NAVIGATEUR — LOT 2 viewer de preuve (#84 : surlignage MULTI-signaux).
 *
 * Un procès-verbal porte PLUSIEURS signaux sur la MÊME page (comme St-Frédéric :
 * A16/Rf51/I93 page 2). On monte SignalPdfOverlay isolé sur un PDF 3 pages dont
 * la page 2 contient TROIS citations distinctes ; on passe les 3 signaux via la
 * prop `signals` (A16 = courant, Rf51 + I93 = secondaires). La QA prouve par
 * capture + assertions que :
 *   - les 3 signaux sont surlignés simultanément sur la page 2 ;
 *   - chacun porte un BADGE ID distinct (A16, Rf51, I93) ;
 *   - les surlignages ont des COULEURS distinctes (le courant mis en avant) ;
 *   - le signal COURANT (A16) est visuellement distingué (classe --current) ;
 *   - le garde de page PAR signal tient (LOT 1 #83) : aucune marque sur p.1/p.3 ;
 *   - le pipeline pdf.js réel (worker, getDocument, render canvas) est exercé.
 */

const pdfFixture = readFileSync(
  fileURLToPath(new URL("./fixtures/preuve-qa-multisignaux.pdf", import.meta.url)),
);

const HARNESS = "/e2e-qa/harness/pdf-overlay.html";
const SHOT_DIR = "/tmp";

// Couleurs reprises de SIGNAL_HIGHLIGHT_PALETTE (rangs 0/1/2). Le rang 0 (ambre)
// est le COURANT mis en avant.
const SIGNALS = [
  {
    id: "sig-A16",
    label: "A16",
    page: 2,
    color: "#f59e0b",
    current: true,
    excerpt:
      "Le conseil adopte le reglement A16 sur la hauteur maximale des batiments dans le secteur central de la ville",
  },
  {
    id: "sig-Rf51",
    label: "Rf51",
    page: 2,
    color: "#3b82f6",
    current: false,
    excerpt:
      "Il est resolu d'autoriser la refonte Rf51 du plan d'urbanisme afin de densifier les abords de la rue Principale",
  },
  {
    id: "sig-I93",
    label: "I93",
    page: 2,
    color: "#10b981",
    current: false,
    excerpt:
      "Le conseil approuve l'investissement I93 pour la requalification du parc municipal et la mise aux normes des infrastructures",
  },
];

async function mockPdf(page: Page): Promise<void> {
  await page.route("**/api/documents/raw*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: pdfFixture,
    }),
  );
}

async function openMulti(page: Page, targetPage = 2): Promise<void> {
  await mockPdf(page);
  const signalsParam = encodeURIComponent(JSON.stringify(SIGNALS));
  await page.goto(
    `${HARNESS}?rawRef=raw/qa/pv.pdf&page=${targetPage}&signals=${signalsParam}`,
  );
  await expect(page.locator(".pdf-canvas-scroll")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".pdf-text-layer .pdf-hl").first()).toBeVisible({
    timeout: 15_000,
  });
}

/** Ensemble des IDs de signal portés par les marques de surlignage. */
async function highlightSignalIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const marks = Array.from(
      document.querySelectorAll<HTMLElement>(".pdf-text-layer .pdf-hl"),
    );
    return Array.from(
      new Set(marks.map((m) => m.dataset.signalId ?? "").filter(Boolean)),
    );
  });
}

test.describe("SignalPdfOverlay — surlignage multi-signaux (LOT 2 #84)", () => {
  test("3 signaux du même PV surlignés sur la page 2, couleurs + badges distincts", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openMulti(page, 2);

    // --- Les 3 signaux sont surlignés (un groupe de marques par signal). ---
    const ids = await highlightSignalIds(page);
    expect(ids.sort()).toEqual(["sig-A16", "sig-I93", "sig-Rf51"]);

    // --- 3 badges ID distincts, lisibles. ---
    const badges = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(".pdf-text-layer .pdf-hl-badge"),
      ).map((b) => ({
        text: b.textContent?.trim() ?? "",
        signalId: b.dataset.signalId ?? "",
        current: b.classList.contains("pdf-hl-badge--current"),
      })),
    );
    const badgeTexts = badges.map((b) => b.text).sort();
    expect(badgeTexts).toEqual(["A16", "I93", "Rf51"]);

    // --- Couleurs distinctes : chaque signal a un background propre. ---
    const colorsBySignal = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const m of document.querySelectorAll<HTMLElement>(
        ".pdf-text-layer .pdf-hl",
      )) {
        const id = m.dataset.signalId ?? "";
        if (id && !out[id]) out[id] = getComputedStyle(m).backgroundColor;
      }
      return out;
    });
    const distinctColors = new Set(Object.values(colorsBySignal));
    expect(distinctColors.size).toBe(3);

    // --- Le signal COURANT (A16) est mis en avant (classe --current). ---
    const currentMarks = await page
      .locator(".pdf-text-layer .pdf-hl--current")
      .count();
    expect(currentMarks).toBeGreaterThan(0);
    const currentBadge = badges.find((b) => b.signalId === "sig-A16");
    expect(currentBadge?.current).toBe(true);
    // Les secondaires ne sont PAS marqués courants.
    expect(badges.find((b) => b.signalId === "sig-Rf51")?.current).toBe(false);
    expect(badges.find((b) => b.signalId === "sig-I93")?.current).toBe(false);

    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-84-multi-page2.png` });
  });

  test("garde de page PAR signal : aucune marque sur les pages 1 et 3", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openMulti(page, 2);

    // Page 2 : marques présentes.
    expect(await page.locator(".pdf-text-layer .pdf-hl").count()).toBeGreaterThan(0);

    // Page 1 : ZÉRO marque (les 3 signaux ciblent la page 2).
    await page.getByRole("button", { name: "Page précédente" }).click();
    await expect(page.locator(".pdf-overlay-meta")).toContainText("Page 1");
    await page.waitForTimeout(300);
    expect(await page.locator(".pdf-text-layer .pdf-hl").count()).toBe(0);
    expect(await page.locator(".pdf-text-layer .pdf-hl-badge").count()).toBe(0);
    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-84-page1-clean.png` });

    // Page 3 : ZÉRO marque également.
    await page.getByRole("button", { name: "Page suivante" }).click();
    await page.getByRole("button", { name: "Page suivante" }).click();
    await expect(page.locator(".pdf-overlay-meta")).toContainText("Page 3");
    await page.waitForTimeout(300);
    expect(await page.locator(".pdf-text-layer .pdf-hl").count()).toBe(0);
    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-84-page3-clean.png` });
  });

  test("badges et surlignages restent alignés au texte après zoom", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openMulti(page, 2);

    const readPct = async () =>
      Number.parseInt(
        (await page.locator(".pdf-zoom-level").textContent())?.replace("%", "") ??
          "0",
        10,
      );
    const startPct = await readPct();

    // Zoome franchement et re-vérifie que les 3 signaux restent surlignés +
    // badgés (le re-render multi-signaux suit l'échelle, non-régression #82).
    const plus = page.getByRole("button", { name: "Zoomer", exact: true });
    const minus = page.getByRole("button", { name: "Dézoomer", exact: true });
    const goUp = startPct < 250;
    for (let i = 0; i < 8; i++) {
      const pct = await readPct();
      if (Math.abs(pct - startPct) / startPct >= 0.4) break;
      await (goUp ? plus : minus).click();
      await page.waitForTimeout(120);
    }
    expect(await readPct()).not.toBe(startPct);

    await expect(page.locator(".pdf-text-layer .pdf-hl").first()).toBeVisible();
    const ids = await highlightSignalIds(page);
    expect(ids.sort()).toEqual(["sig-A16", "sig-I93", "sig-Rf51"]);
    const badgeCount = await page.locator(".pdf-text-layer .pdf-hl-badge").count();
    expect(badgeCount).toBe(3);

    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-84-multi-zoom.png` });
  });
});
