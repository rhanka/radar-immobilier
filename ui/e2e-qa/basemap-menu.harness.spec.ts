import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — §5 R3 P1+P3 : le menu « Fond de carte » (trigger `Layers`)
 * S'OUVRE et s'ANCRE correctement.
 *
 * Contexte (feedback owner préprod a7c84e1) :
 *  - P1 (desktop) : clic sur `Layers` → le menu NE s'ouvrait PAS (le popover DS
 *    partait HORS-VIEWPORT en bas-droite ; seule restait la bulle d'attribution
 *    MapLibre). Cause : le `MenuPopover` DS calcule des coordonnées VIEWPORT mais
 *    se pose en `position: absolute` → dans le conteneur de contrôles positionné
 *    (`.absolute … right-3`), son offsetParent n'est PAS le body → décalage.
 *  - P3 (responsive) : le menu s'ouvrait « bas-droite au lieu de haut-gauche »
 *    (+ clignotement, le panneau hors-champ étirant la zone défilable).
 *
 * Fix : le popover porte `position: fixed` (coordonnées relatives au viewport,
 * échappe au `overflow-hidden` de la racine) → panneau ON-SCREEN, ancré
 * HAUT-GAUCHE (coin bas-droit au-dessus du trigger, bord droit aligné).
 *
 * Surface PUREMENT DOM/CSS : indépendante de MapLibre/WebGL (indisponible en
 * headless). Les contrôles bas-droit du socle sont rendus quel que soit l'état
 * de la carte → le popover est mesurable dans un VRAI navigateur.
 */

const HARNESS = "/e2e-qa/harness/basemap-menu.html";

async function openMenuAndMeasure(
  page: import("@playwright/test").Page,
  width: number,
  height: number,
) {
  await page.setViewportSize({ width, height });
  await page.goto(HARNESS);
  await expect(page.locator("#ready")).toHaveText("ready");

  const trigger = page.locator('[data-testid="basemap-menu-trigger"]');
  await expect(trigger).toBeVisible();
  const triggerBox = await trigger.boundingBox();
  if (!triggerBox) throw new Error("trigger has no bounding box");

  await trigger.click();

  // Le menu est ouvert : les deux options radio Plan/Satellite sont présentes.
  await expect(page.locator('[data-testid="basemap-option-plan"]')).toBeVisible();
  await expect(
    page.locator('[data-testid="basemap-option-satellite"]'),
  ).toBeVisible();

  const dialog = page.locator('[role="dialog"][aria-label="Fond de carte"]');
  await expect(dialog).toBeVisible();
  // Le fix impose `position: fixed` (offsetParent = viewport) : c'est la CAUSE
  // corrigée (le popover DS partait en `absolute` relatif au conteneur de
  // contrôles positionné → hors-viewport). On l'asserte directement.
  await expect(dialog).toHaveCSS("position", "fixed");
  // Petit délai : laisse le `$effect` de positionnement DS se stabiliser.
  await page.waitForTimeout(120);
  const panelBox = await dialog.boundingBox();
  if (!panelBox) throw new Error("panel has no bounding box");

  return { triggerBox, panelBox, width, height };
}

for (const vp of [
  { name: "desktop 1280×720 (P1)", width: 1280, height: 720 },
  { name: "responsive 390×844 (P3)", width: 390, height: 844 },
]) {
  test(`menu Fond de carte — ${vp.name} : s'ouvre ON-SCREEN, ancré HAUT-GAUCHE`, async ({
    page,
  }) => {
    const { triggerBox, panelBox, width, height } = await openMenuAndMeasure(
      page,
      vp.width,
      vp.height,
    );

    // (1) ENTIÈREMENT dans le viewport — bug P1/P3 : partait hors-champ.
    expect(panelBox.x, "panneau: bord gauche >= 0").toBeGreaterThanOrEqual(0);
    expect(panelBox.y, "panneau: bord haut >= 0").toBeGreaterThanOrEqual(0);
    expect(
      panelBox.x + panelBox.width,
      "panneau: bord droit dans le viewport",
    ).toBeLessThanOrEqual(width + 1);
    expect(
      panelBox.y + panelBox.height,
      "panneau: bord bas dans le viewport",
    ).toBeLessThanOrEqual(height + 1);

    // (2) ANCRÉ VERS LE HAUT : le bas du panneau est au-dessus du haut du trigger
    // (placement top-end). Bug P3 : s'ouvrait vers le BAS.
    expect(
      panelBox.y + panelBox.height,
      "panneau ancré au-dessus du trigger",
    ).toBeLessThanOrEqual(triggerBox.y + 2);

    // (3) ALIGNÉ À DROITE du trigger (top-END) : bords droits ~confondus. Bug P3 :
    // décalé vers la DROITE (hors-champ).
    expect(
      Math.abs(panelBox.x + panelBox.width - (triggerBox.x + triggerBox.width)),
      "bord droit du panneau aligné au trigger",
    ).toBeLessThanOrEqual(2);
  });
}

/**
 * §5 R4 B — les ITEMS du menu « Fond de carte » suivent les tokens DS MENU-ROW.
 *
 * Feedback owner : l'option ACTIVE s'affichait en « bleu plein basique » (aplat
 * `background: action-primary` + texte blanc). La recette DS (groundée
 * `Menu.svelte`) proscrit tout aplat de sélection (aucun token surface-selected
 * au DS) : l'ACTIF se marque par un glyph lucide `Check` (accent
 * `--st-semantic-action-primary`) dans une colonne RÉSERVÉE (Plan/Satellite
 * alignés) + un label `--st-semantic-text-primary` weight 500. Surface PUREMENT
 * DOM/CSS (indépendante de MapLibre/WebGL).
 */
test.describe("§5 R4 B — items du menu Fond de carte aux tokens DS menu-row", () => {
  test("actif = coche (pas d'aplat bleu, texte NON blanc) ; inactif = coche masquée ; labels alignés", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(HARNESS);
    await expect(page.locator("#ready")).toHaveText("ready");

    await page.locator('[data-testid="basemap-menu-trigger"]').click();
    const plan = page.locator('[data-testid="basemap-option-plan"]');
    const sat = page.locator('[data-testid="basemap-option-satellite"]');
    await expect(plan).toBeVisible();
    await expect(sat).toBeVisible();
    // Défaut mode = "plan" → Plan est l'option ACTIVE.
    await expect(plan).toHaveAttribute("aria-checked", "true");
    await expect(sat).toHaveAttribute("aria-checked", "false");

    const probe = await page.evaluate(() => {
      const plan = document.querySelector('[data-testid="basemap-option-plan"]') as HTMLElement;
      const sat = document.querySelector('[data-testid="basemap-option-satellite"]') as HTMLElement;
      const checkVis = (el: HTMLElement) => {
        const c = el.querySelector(".basemap-menu__check") as HTMLElement | null;
        return c ? getComputedStyle(c).visibility : "missing";
      };
      const labelX = (el: HTMLElement) => {
        const l = el.querySelector(".basemap-menu__label") as HTMLElement | null;
        return l ? Math.round(l.getBoundingClientRect().x) : NaN;
      };
      const labelWeight = (el: HTMLElement) => {
        const l = el.querySelector(".basemap-menu__label") as HTMLElement | null;
        return l ? getComputedStyle(l).fontWeight : "missing";
      };
      // Couleur ACTION-PRIMARY résolue par le thème (pour prouver que l'actif NE
      // porte PAS cet aplat) via un élément-sonde.
      const s = document.createElement("div");
      s.style.background = "var(--st-semantic-action-primary)";
      document.body.appendChild(s);
      const actionPrimary = getComputedStyle(s).backgroundColor;
      s.remove();
      return {
        planCheckVis: checkVis(plan),
        satCheckVis: checkVis(sat),
        planLabelX: labelX(plan),
        satLabelX: labelX(sat),
        planLabelWeight: labelWeight(plan),
        satLabelWeight: labelWeight(sat),
        planBg: getComputedStyle(plan).backgroundColor,
        planColor: getComputedStyle(plan).color,
        actionPrimary,
      };
    });

    // ACTIF : coche VISIBLE ; INACTIF : coche MASQUÉE (colonne réservée → alignement).
    expect(probe.planCheckVis, "coche de l'option active visible").toBe("visible");
    expect(probe.satCheckVis, "coche de l'option inactive masquée").toBe("hidden");
    // Colonne « coche » réservée → les DEUX labels démarrent au même x.
    expect(Math.abs(probe.planLabelX - probe.satLabelX)).toBeLessThanOrEqual(1);
    // Label actif en weight 500 ; inactif en poids normal.
    expect(probe.planLabelWeight).toBe("500");
    expect(["400", "normal"]).toContain(probe.satLabelWeight);
    // PAS d'aplat « bleu plein » : le fond de l'actif N'EST PAS action-primary, et
    // le texte N'EST PAS blanc (l'ancien aplat posait texte blanc sur fond bleu).
    expect(probe.planBg, "actif sans aplat action-primary").not.toBe(probe.actionPrimary);
    expect(probe.planColor, "texte de l'actif non blanc").not.toBe("rgb(255, 255, 255)");
  });
});
