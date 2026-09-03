import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — nav-drill clic carte (bug owner 01KZEG78 : « le clic va
 * toujours direct sur le lot »). Modèle owner validé : 2 clics stricts
 * ville→zone→lot sur la CARTE, lot-à-lot libre dans la zone.
 *
 * MapLibre/WebGL n'est PAS disponible en chromium headless (sonde WEBGL=NO, cf.
 * geo-level.harness) → on ne peut pas piloter la carte RENDUE en CI. On valide
 * ici, dans un VRAI navigateur, la DÉCISION corrigée du clic lot (la logique
 * exacte câblée dans SignauxMapView.handleLotClick) :
 *  - vue VILLE (pas de zone entrée) : un clic LOT RÉSOUT vers sa ZONE (entrée en
 *    vue zone) — PLUS de saut direct au lot ;
 *  - vue ZONE (zone entrée) : un clic LOT sélectionne le lot (drawer, zone
 *    reste active) — lot-à-lot libre ;
 *  - sans zone dérivable en vue ville : neutre (jamais une sélection lot).
 * Le comportement de la carte RÉELLEMENT rendue (clic pixel) reste à valider
 * LIVE côté owner — non falsifiable en headless (WEBGL=NO).
 */

const HARNESS = "/e2e-qa/harness/navdrill-lotclick.html";

test.describe("Nav-drill — décision clic carte lot (logique navigateur)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS);
    await expect(page.locator("#ready")).toHaveText("ready");
  });

  test("vue VILLE : clic lot RÉSOUT vers sa zone (pas de saut au lot)", async ({
    page,
  }) => {
    const res = await page.evaluate(() =>
      window.__resolveGeoLotClick({ hasZoneSelection: false, zoneCode: "H-104" }),
    );
    expect(res).toEqual({ kind: "enter-zone", code: "H-104" });
  });

  test("vue ZONE : clic lot SÉLECTIONNE le lot (drawer, zone reste active)", async ({
    page,
  }) => {
    const res = await page.evaluate(() =>
      window.__resolveGeoLotClick({ hasZoneSelection: true, zoneCode: "H-104" }),
    );
    expect(res).toEqual({ kind: "select-lot" });
  });

  test("vue VILLE sans zone dérivable : neutre (jamais une sélection lot)", async ({
    page,
  }) => {
    const res = await page.evaluate(() =>
      window.__resolveGeoLotClick({ hasZoneSelection: false, zoneCode: null }),
    );
    expect(res).toEqual({ kind: "ignore" });
  });
});
