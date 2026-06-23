import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * QA NAVIGATEUR — viewer de preuve : chargement plus rapide (#89) + waiter au
 * switch de PDF (#90).
 *
 * On monte SignalPdfOverlay via le harnais `pdf-switch` qui pilote les props à
 * chaud (`window.__setPdfProps`) SUR LA MÊME PAGE — indispensable pour exercer
 * le cache module-level (#89c) et le switch de doc (#90) sans ré-évaluer le
 * module (ce qui viderait le cache).
 *
 * Ce que ce spec PROUVE :
 *   - #90 : au switch A→B, le waiter (.pdf-loading) s'affiche, le stage canvas
 *     de l'ANCIEN doc est masqué (.is-loading) — pas d'écran figé/résiduel ;
 *     puis le nouveau doc se rend (.pdf-canvas-stage visible). Erreur → fallback
 *     .pdf-missing (couvert par pdf-overlay.harness.spec).
 *   - #89c : réouvrir le MÊME rawRef ne refait AUCUN fetch (compteur réseau) et
 *     est nettement plus rapide (mesure window.__pdfPerf, ratio chiffré).
 *
 * Aucun stack docker ; /api/documents/raw mocké avec de vrais binaires PDF.
 */

const pdfA = readFileSync(
  fileURLToPath(new URL("./fixtures/preuve-qa-multipage.pdf", import.meta.url)),
);
const pdfB = readFileSync(
  fileURLToPath(new URL("./fixtures/preuve-qa-multisignaux.pdf", import.meta.url)),
);

const HARNESS = "/e2e-qa/harness/pdf-switch.html";
const SHOT_DIR = "/tmp";

const REF_A = "raw/qa/doc-a.pdf";
const REF_B = "raw/qa/doc-b.pdf";

type PerfMark = { url: string; ms: number; cached: boolean };

/**
 * Mock /api/documents/raw : sert pdfA pour REF_A, pdfB pour REF_B, en comptant
 * les fetchs RÉELS par rawRef (pour prouver le cache). Un délai artificiel sur
 * A (uniquement au 1er fetch) rend le waiter du switch observable.
 */
function installMock(page: Page): { fetches: Record<string, number> } {
  const fetches: Record<string, number> = { [REF_A]: 0, [REF_B]: 0 };
  void page.route("**/api/documents/raw*", async (route) => {
    const url = new URL(route.request().url());
    const rawRef = url.searchParams.get("rawRef") ?? "";
    const body = rawRef === REF_B ? pdfB : pdfA;
    if (rawRef in fetches) fetches[rawRef] += 1;
    // Latence réseau simulée : laisse le waiter (#90) visible un court instant.
    await new Promise((r) => setTimeout(r, 250));
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body,
    });
  });
  return { fetches };
}

/** Arme le sink de perf AVANT tout montage (sinon recordPerf est no-op). */
async function armPerfSink(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __pdfPerf: PerfMark[] }).__pdfPerf = [];
  });
}

async function setProps(
  page: Page,
  props: { rawRef: string; page?: number },
): Promise<void> {
  await page.evaluate((p) => {
    (
      window as unknown as { __setPdfProps: (x: unknown) => void }
    ).__setPdfProps(p);
  }, props);
}

async function readPerf(page: Page): Promise<PerfMark[]> {
  return page.evaluate(
    () => (window as unknown as { __pdfPerf: PerfMark[] }).__pdfPerf,
  );
}

async function waitRendered(page: Page): Promise<void> {
  // Rendu = stage visible (non masqué) ET waiter disparu.
  await expect(page.locator(".pdf-canvas-stage")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".pdf-canvas-stage.is-loading")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.locator(".pdf-loading")).toHaveCount(0, { timeout: 15_000 });
}

test.describe("SignalPdfOverlay — perf chargement (#89) + waiter switch (#90)", () => {
  test("waiter visible au switch de PDF, sans ancien-doc résiduel (#90)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await armPerfSink(page);
    installMock(page);

    await page.goto(HARNESS);
    // Ouverture initiale du doc A.
    await setProps(page, { rawRef: REF_A, page: 1 });
    await waitRendered(page);

    // SWITCH vers B : le waiter doit apparaître et le stage de A être masqué
    // (is-loading) AVANT que B ne soit rendu. Le délai mock (250ms) garantit la
    // fenêtre d'observation.
    await setProps(page, { rawRef: REF_B, page: 1 });

    // Pendant le chargement de B : waiter affiché + stage masqué (pas le canvas
    // de A visible dessous) → preuve du reset franc #90.
    await expect(page.locator(".pdf-loading")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".pdf-canvas-stage.is-loading")).toHaveCount(1, {
      timeout: 5_000,
    });
    // Pendant le chargement, la toolbar pager/zoom du doc A a disparu (pdfDoc
    // remis à null au début du switch) — pas de contrôle d'un doc obsolète.
    await expect(page.locator(".pdf-zoom")).toHaveCount(0);

    // Capture l'état loading (preuve visuelle #90).
    await page.screenshot({ path: `${SHOT_DIR}/pdf-evol-90-switch-loading.png` });

    // Puis B se rend proprement.
    await waitRendered(page);
    await page.screenshot({ path: `${SHOT_DIR}/pdf-evol-90-switch-rendered.png` });
  });

  test("réouverture du même rawRef : depuis le cache, sans re-fetch, plus rapide (#89)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await armPerfSink(page);
    const { fetches } = installMock(page);

    await page.goto(HARNESS);

    // 1) Ouverture A (miss : fetch + parse).
    await setProps(page, { rawRef: REF_A, page: 1 });
    await waitRendered(page);
    expect(fetches[REF_A]).toBe(1);

    // 2) Switch vers B (charge un autre doc, A reste en cache).
    await setProps(page, { rawRef: REF_B, page: 1 });
    await waitRendered(page);
    expect(fetches[REF_B]).toBe(1);

    // 3) Retour à A : DOIT venir du cache → AUCUN nouveau fetch de A.
    await setProps(page, { rawRef: REF_A, page: 1 });
    await waitRendered(page);
    expect(fetches[REF_A]).toBe(1); // toujours 1 : pas de re-fetch (#89c)

    const marks = await readPerf(page);
    // Marques attendues : A(miss), B(miss), A(cached).
    expect(marks.length).toBeGreaterThanOrEqual(3);
    const firstA = marks.find((m) => m.url.includes("doc-a.pdf") && !m.cached);
    const reopenA = marks.filter((m) => m.url.includes("doc-a.pdf") && m.cached);
    expect(firstA).toBeTruthy();
    expect(reopenA.length).toBeGreaterThanOrEqual(1);

    const baselineMs = firstA!.ms;
    const cachedMs = reopenA[reopenA.length - 1]!.ms;
    // Perf #89 chiffrée : la réouverture (cache, pas de fetch+parse) est
    // nettement plus rapide. Le mock ajoute 250ms de latence réseau au 1er open
    // qui DISPARAÎT à la réouverture → marge large et stable.
    expect(cachedMs).toBeLessThan(baselineMs);

    // Trace lisible dans le rapport Playwright (mesure avant/après).
    console.log(
      `[#89 perf] open A (miss) = ${baselineMs.toFixed(1)}ms ; ` +
        `réouverture A (cache) = ${cachedMs.toFixed(1)}ms ; ` +
        `gain = ${(baselineMs - cachedMs).toFixed(1)}ms ` +
        `(${(100 * (1 - cachedMs / baselineMs)).toFixed(0)}%).`,
    );

    await page.screenshot({ path: `${SHOT_DIR}/pdf-evol-89-reopen-cached.png` });
  });
});
