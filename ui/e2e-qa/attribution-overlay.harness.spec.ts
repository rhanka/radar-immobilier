import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — §5 R3 : ATTRIBUTION en overlay LÉGER contextuel, ZÉRO décalage.
 *
 * Comble le gap STRUCTURE ≠ RUNTIME (leçon #648) : le test de construction
 * « attributionControl:false » PASSAIT, mais seul le RENDU RÉEL servi prouve
 * l'état de l'attribution. Ce test monte le VRAI socle `GeoCityMapBase` (via le
 * harnais `basemap-menu.html`, mode PLAN par défaut) dans un VRAI navigateur, en
 * viewport MOBILE 390×844, et vérifie AU RUNTIME :
 *
 *  (a) AUCUN élément d'attribution par défaut de MapLibre qui prend de l'espace :
 *      le conteneur `maplibregl-ctrl-bottom-right` reste VIDE (pas de bulle
 *      « © OpenStreetMap contributors | MapLibre » + ▼ ni de `.maplibregl-ctrl-attrib`).
 *  (b) L'overlay léger `[data-testid="map-attribution"]` est PRÉSENT, CONTEXTUEL
 *      (« © OpenStreetMap » en plan/OSM, `data-attribution-layer="osm"`), CENTRÉ
 *      horizontalement, en `position: absolute` HORS-FLUX (ne décale rien : pas de
 *      scroll horizontal, hauteur document = viewport).
 *  (c) PAS d'espace blanc sous la carte : le socle remplit la hauteur du viewport.
 *
 * AVANT le fix (#648 servi), `[data-testid="map-attribution"]` N'EXISTE PAS →
 * l'assertion (b) échoue (preuve ROUGE). Après le fix → VERT.
 *
 * Surface DOM/CSS : l'overlay OSM est rendu dès le montage (état `satelliteActive`
 * = false par défaut), indépendamment de l'init WebGL MapLibre.
 */

const HARNESS = "/e2e-qa/harness/basemap-menu.html";
const VIEWPORT = { width: 390, height: 844 };

test.describe("§5 R3 — attribution overlay léger contextuel (390×844)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto(HARNESS);
    await expect(page.locator("#ready")).toHaveText("ready");
    // Laisse MapLibre tenter son init (le conteneur de contrôles par défaut est
    // rendu même si WebGL échoue) puis la réactivité Svelte se stabiliser.
    await page.waitForTimeout(300);
  });

  test("(a) aucun contrôle d'attribution par défaut MapLibre qui prend de l'espace", async ({
    page,
  }) => {
    // Aucune bulle `.maplibregl-ctrl-attrib` visible/à espace (le compact ▼ + texte
    // « © OpenStreetMap contributors | MapLibre » du contrôle par défaut).
    const defaultAttrib = page.locator(".maplibregl-ctrl-attrib");
    expect(await defaultAttrib.count()).toBe(0);
    // Le conteneur bas-droite MapLibre existe mais reste VIDE (hauteur nulle).
    const bottomRight = page.locator(".maplibregl-ctrl-bottom-right");
    if ((await bottomRight.count()) > 0) {
      const box = await bottomRight.first().boundingBox();
      expect(box?.height ?? 0).toBeLessThanOrEqual(1);
    }
  });

  test("(b) overlay léger présent, contextuel « © OpenStreetMap », centré, hors-flux", async ({
    page,
  }) => {
    const overlay = page.locator('[data-testid="map-attribution"]');
    await expect(overlay).toBeVisible();
    // Contextuel à la layer OSM/plan.
    await expect(overlay).toHaveAttribute("data-attribution-layer", "osm");
    await expect(overlay).toContainText("© OpenStreetMap");

    // Hors-flux : position absolue (ne participe pas au flux → ne décale rien).
    await expect(overlay).toHaveCSS("position", "absolute");

    // CENTRÉ horizontalement dans le viewport (± 4px de tolérance de rendu).
    const box = await overlay.boundingBox();
    if (!box) throw new Error("overlay sans bounding box");
    const overlayCenter = box.x + box.width / 2;
    expect(Math.abs(overlayCenter - VIEWPORT.width / 2)).toBeLessThanOrEqual(4);

    // ZÉRO décalage : pas de scroll horizontal, hauteur document = viewport
    // (l'overlay ne pousse pas le layout).
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
  });

  test("(c) pas d'espace blanc sous la carte : le socle remplit le viewport", async ({
    page,
  }) => {
    const base = page.locator('[data-testid="geo-city-map-base"]');
    await expect(base).toBeVisible();
    const box = await base.boundingBox();
    if (!box) throw new Error("socle sans bounding box");
    // Le socle démarre en haut et descend jusqu'au bas du viewport (± 1px).
    expect(box.y).toBeLessThanOrEqual(1);
    expect(box.y + box.height).toBeGreaterThanOrEqual(VIEWPORT.height - 1);
  });
});
