import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/**
 * QA NAVIGATEUR — HEADER de NAVIGATION PAR SIGNAL (#91) + cross-highlight (#86)
 * + hover-card hors-filtre (#4) du viewer de preuve.
 *
 * Le harnais `pdf-nav` monte UN SignalPdfOverlay et reproduit le rôle du parent
 * (navSignals/navIndex/signals/onNavigate) ; on pilote des scénarios MULTI-PDF
 * via `window.__setNavScenario`. /api/documents/raw est mocké : doc A (3 pages,
 * multi-signaux page 2) pour les rawRef "raw/qa/pv-a.pdf", doc B (multipage)
 * pour "raw/qa/pv-b.pdf". Aucun stack docker.
 *
 * PROUVE par captures + assertions :
 *   - header nav-signal ◀ Signal ▶ + compteur i/N + pastille + PDF i/N ;
 *   - next signal INTRA-PDF (recentre, pas de rechargement) ;
 *   - next signal CROSS-PDF (waiter + change de doc, PDF i/N mis à jour) ;
 *   - menu déroulant « aller à » groupé par document + recherche ;
 *   - hors-filtre slate + badge creux + toggle masquer ;
 *   - hover-card hors-filtre (miroir fiche + actions) ;
 *   - cross-highlight : hover badge → émission hover (sens viewer→fiche).
 */

// Doc A : 3 pages, page 2 porte 3 citations distinctes (A16/Rf51/I93).
const pdfA = readFileSync(
  fileURLToPath(new URL("./fixtures/preuve-qa-multisignaux.pdf", import.meta.url)),
);
// Doc B : multipage (citations sur pages distinctes).
const pdfB = readFileSync(
  fileURLToPath(new URL("./fixtures/preuve-qa-multipage.pdf", import.meta.url)),
);

const HARNESS = "/e2e-qa/harness/pdf-nav.html";
const SHOT_DIR = "/tmp";

const REF_A = "raw/qa/pv-a.pdf";
const REF_B = "raw/qa/pv-b.pdf";

// Excerpts qui matchent VRAIMENT le texte des fixtures (repris des specs #84).
const EX_A16 =
  "Le conseil adopte le reglement A16 sur la hauteur maximale des batiments dans le secteur central de la ville";
const EX_RF51 =
  "Il est resolu d'autoriser la refonte Rf51 du plan d'urbanisme afin de densifier les abords de la rue Principale";
const EX_I93 =
  "Le conseil approuve l'investissement I93 pour la requalification du parc municipal et la mise aux normes des infrastructures";

type ScenarioSignal = {
  id: string;
  label: string;
  color: string;
  page: number;
  rawRef: string;
  docTitle: string;
  excerpt: string;
  inFilter: boolean;
  reglement?: string;
  zoneRef?: string;
};

/** Scénario MULTI-PDF : 3 signaux sur doc A (page 2) + 1 sur doc B (page 1). */
function multiDocScenario(): ScenarioSignal[] {
  return [
    {
      id: "sig-A16",
      label: "A16",
      color: "#f59e0b",
      page: 2,
      rawRef: REF_A,
      docTitle: "pv-a",
      excerpt: EX_A16,
      inFilter: true,
    },
    {
      id: "sig-Rf51",
      label: "Rf51",
      color: "#3b82f6",
      page: 2,
      rawRef: REF_A,
      docTitle: "pv-a",
      excerpt: EX_RF51,
      inFilter: true,
    },
    {
      id: "sig-I93",
      label: "I93",
      color: "#10b981",
      page: 2,
      rawRef: REF_A,
      docTitle: "pv-a",
      // I93 HORS-FILTRE pour le test #4 (slate + hover-card).
      excerpt: EX_I93,
      inFilter: false,
      reglement: "2024-93",
      zoneRef: "P-12",
    },
    {
      id: "sig-B1",
      label: "B1",
      color: "#ec4899",
      page: 1,
      rawRef: REF_B,
      docTitle: "pv-b",
      excerpt: "Document multipage de preuve QA",
      inFilter: true,
    },
  ];
}

function installMock(page: Page): { fetches: Record<string, number> } {
  const fetches: Record<string, number> = { [REF_A]: 0, [REF_B]: 0 };
  void page.route("**/api/documents/raw*", async (route) => {
    const url = new URL(route.request().url());
    const rawRef = url.searchParams.get("rawRef") ?? "";
    const body = rawRef === REF_B ? pdfB : pdfA;
    if (rawRef in fetches) fetches[rawRef] += 1;
    await new Promise((r) => setTimeout(r, 200)); // waiter #90 observable
    await route.fulfill({ status: 200, contentType: "application/pdf", body });
  });
  return { fetches };
}

async function setScenario(
  page: Page,
  p: {
    scenario?: ScenarioSignal[];
    navIndex?: number;
    hideOutOfFilter?: boolean;
    hoveredSignalId?: string | null;
  },
): Promise<void> {
  await page.evaluate((x) => {
    (
      window as unknown as { __setNavScenario: (y: unknown) => void }
    ).__setNavScenario(x);
  }, p);
}

async function waitRendered(page: Page): Promise<void> {
  await expect(page.locator(".pdf-canvas-stage")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".pdf-canvas-stage.is-loading")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.locator(".pdf-loading")).toHaveCount(0, { timeout: 15_000 });
}

test.describe("SignalPdfOverlay — navigation par signal (#91/#86/#4)", () => {
  test("header nav : ◀ Signal ▶ + compteur i/N + pastille + PDF i/N (multi-doc)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    installMock(page);
    await page.goto(HARNESS);
    await setScenario(page, { scenario: multiDocScenario(), navIndex: 0 });
    await waitRendered(page);

    // Rangée nav présente avec compteur 1/4.
    const counter = page.locator(".pdf-nav-counter");
    await expect(counter).toBeVisible();
    await expect(counter).toContainText("Signal");
    await expect(counter.locator(".pdf-nav-counter-pos")).toContainText("1");
    await expect(counter.locator(".pdf-nav-counter-pos")).toContainText("4");

    // Pastille couleur du signal courant (A16 ambre).
    const dot = counter.locator(".pdf-nav-dot");
    await expect(dot).toBeVisible();

    // Multi-doc ⇒ indicateur PDF i/N visible (doc A = 1/2).
    const pdfCount = page.locator(".pdf-nav-pdfcount");
    await expect(pdfCount).toBeVisible();
    await expect(pdfCount).toContainText("PDF 1/2");

    // Bornes : « Signal précédent » désactivé au rang 1.
    await expect(
      page.getByRole("button", { name: "Signal précédent" }),
    ).toBeDisabled();

    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-01-header.png` });
  });

  test("next signal INTRA-PDF : compteur avance, reste sur le même doc, pas de re-fetch", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { fetches } = installMock(page);
    await page.goto(HARNESS);
    await setScenario(page, { scenario: multiDocScenario(), navIndex: 0 });
    await waitRendered(page);
    expect(fetches[REF_A]).toBe(1);

    // Next signal → A16 (1) → Rf51 (2), même doc A.
    await page.getByRole("button", { name: "Signal suivant" }).click();
    await expect(
      page.locator(".pdf-nav-counter .pdf-nav-counter-pos"),
    ).toContainText("2");
    // Toujours doc A : aucun nouveau fetch (intra-PDF via cache/page).
    await page.waitForTimeout(300);
    expect(fetches[REF_A]).toBe(1);
    await expect(page.locator(".pdf-nav-pdfcount")).toContainText("PDF 1/2");

    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-02-intra.png` });
  });

  test("next signal CROSS-PDF : waiter + change de doc + PDF i/N mis à jour", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { fetches } = installMock(page);
    await page.goto(HARNESS);
    // Démarre sur le DERNIER signal du doc A (I93, index 2).
    await setScenario(page, { scenario: multiDocScenario(), navIndex: 2 });
    await waitRendered(page);
    expect(fetches[REF_A]).toBe(1);
    expect(fetches[REF_B]).toBe(0);

    // Next → B1 (index 3) : autre doc → le viewer recharge (waiter visible).
    await page.getByRole("button", { name: "Signal suivant" }).click();
    await expect(page.locator(".pdf-loading")).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-03-cross-loading.png` });

    await waitRendered(page);
    expect(fetches[REF_B]).toBe(1); // doc B fetché
    await expect(
      page.locator(".pdf-nav-counter .pdf-nav-counter-pos"),
    ).toContainText("4");
    await expect(page.locator(".pdf-nav-pdfcount")).toContainText("PDF 2/2");
    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-03-cross-rendered.png` });
  });

  test("menu déroulant « aller à » : groupé par document + recherche + saut", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    installMock(page);
    await page.goto(HARNESS);
    await setScenario(page, { scenario: multiDocScenario(), navIndex: 0 });
    await waitRendered(page);

    // Ouvre le menu via le compteur.
    await page.locator(".pdf-nav-counter").click();
    const menu = page.locator(".pdf-nav-menu");
    await expect(menu).toBeVisible();

    // Groupé par document : 2 en-têtes de groupe (multi-doc).
    await expect(menu.locator(".pdf-nav-menu-group-head")).toHaveCount(2);
    // 4 items au total (A16, Rf51, I93, B1).
    await expect(menu.locator(".pdf-nav-menu-item")).toHaveCount(4);
    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-04-menu-grouped.png` });

    // Recherche « B1 » filtre à 1 item.
    await menu.locator(".pdf-nav-menu-input").fill("B1");
    await expect(menu.locator(".pdf-nav-menu-item")).toHaveCount(1);
    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-04-menu-search.png` });

    // Cliquer l'item saute au signal (cross-PDF vers B).
    await menu.locator(".pdf-nav-menu-item").first().click();
    await expect(menu).toHaveCount(0); // menu fermé
    await waitRendered(page);
    await expect(
      page.locator(".pdf-nav-counter .pdf-nav-counter-pos"),
    ).toContainText("4");
  });

  test("hors-filtre : surlignage slate + badge creux, et toggle « masquer »", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    installMock(page);
    await page.goto(HARNESS);
    // Reste sur doc A, page 2 : A16+Rf51 dans-filtre, I93 hors-filtre.
    await setScenario(page, { scenario: multiDocScenario(), navIndex: 0 });
    await waitRendered(page);
    await expect(page.locator(".pdf-text-layer .pdf-hl").first()).toBeVisible({
      timeout: 15_000,
    });

    // I93 hors-filtre : présent comme marque --out + badge --out (creux).
    await expect(
      page.locator('.pdf-hl--out[data-signal-id="sig-I93"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('.pdf-hl-badge--out[data-signal-id="sig-I93"]'),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-05-horsfiltre-visible.png` });

    // Toggle « masquer hors-filtre » → I93 disparaît, A16/Rf51 restent.
    await page.getByRole("button", { name: /Hors-filtre/ }).click();
    await page.waitForTimeout(300);
    await expect(
      page.locator('.pdf-hl[data-signal-id="sig-I93"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('.pdf-hl[data-signal-id="sig-A16"]').first(),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-05-horsfiltre-hidden.png` });
  });

  test("hover-card hors-filtre : popover miroir (titre/règlement/zone/citation/actions)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    installMock(page);
    await page.goto(HARNESS);
    await setScenario(page, { scenario: multiDocScenario(), navIndex: 0 });
    await waitRendered(page);
    await expect(
      page.locator('.pdf-hl-badge--out[data-signal-id="sig-I93"]'),
    ).toBeVisible({ timeout: 15_000 });

    // Survol du badge I93 hors-filtre → hover-card.
    await page.locator('.pdf-hl-badge--out[data-signal-id="sig-I93"]').hover();
    const card = page.locator(".pdf-hovercard");
    await expect(card).toBeVisible();
    await expect(card).toContainText("I93");
    await expect(card).toContainText("2024-93"); // règlement
    await expect(card).toContainText("P-12"); // zone
    await expect(card.getByRole("button", { name: "Voir comme courant" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Ajouter au filtre" })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-06-hovercard.png` });

    // « Voir comme courant » → I93 devient le signal courant (index 3 = I93).
    await card.getByRole("button", { name: "Voir comme courant" }).click();
    await expect(
      page.locator(".pdf-nav-counter .pdf-nav-counter-pos"),
    ).toContainText("3");
  });

  test("cross-highlight #86 : hover externe pulse le surlignage ; hover badge émet le hover", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    installMock(page);
    await page.goto(HARNESS);
    await setScenario(page, { scenario: multiDocScenario(), navIndex: 0 });
    await waitRendered(page);
    await expect(page.locator(".pdf-text-layer .pdf-hl").first()).toBeVisible({
      timeout: 15_000,
    });

    // Sens FICHE → VIEWER : hoveredSignalId=Rf51 → la marque Rf51 pulse.
    await setScenario(page, { hoveredSignalId: "sig-Rf51" });
    await expect(
      page.locator('.pdf-hl--pulse[data-signal-id="sig-Rf51"]').first(),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-07-pulse.png` });

    // Retrait du hover → plus de pulse.
    await setScenario(page, { hoveredSignalId: null });
    await expect(page.locator(".pdf-hl--pulse")).toHaveCount(0);

    // Sens VIEWER → FICHE : hover du badge A16 (dans-filtre) émet le hover.
    await page.locator('.pdf-hl-badge[data-signal-id="sig-A16"]').hover();
    await expect
      .poll(async () =>
        page.evaluate(
          () => (window as unknown as { __lastHover?: string | null }).__lastHover,
        ),
      )
      .toBe("sig-A16");
  });

  test("toast d'ancrage #86 : signal survolé sur une AUTRE page → mini-toast cliquable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    installMock(page);
    await page.goto(HARNESS);
    await setScenario(page, { scenario: multiDocScenario(), navIndex: 0 });
    await waitRendered(page);

    // Le doc s'ouvre sur la page 2 (page du signal courant A16). On descend
    // à la page 1 via « Page précédente » (les surlignages restent page 2).
    await expect(page.locator(".pdf-overlay-meta")).toContainText("Page 2");
    await page.getByRole("button", { name: "Page précédente" }).click();
    await expect(page.locator(".pdf-overlay-meta")).toContainText("Page 1");

    // Hover externe d'A16 (page 2) depuis la page 1 → toast d'ancrage.
    await setScenario(page, { hoveredSignalId: "sig-A16" });
    const toast = page.locator(".pdf-anchor-toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("page 2");
    await page.screenshot({ path: `${SHOT_DIR}/pdf-nav-08-anchor-toast.png` });

    // Clic sur le toast → va à la page 2.
    await toast.click();
    await expect(page.locator(".pdf-overlay-meta")).toContainText("Page 2");
  });
});
