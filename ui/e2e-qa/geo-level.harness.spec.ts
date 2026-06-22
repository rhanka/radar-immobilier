import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — Bug #4 (dézoom région : focus ville → vue province).
 *
 * MapLibre/WebGL n'est pas disponible en chromium headless (sonde WEBGL=NO),
 * donc on ne peut pas piloter la carte rendue. On valide ici, dans un VRAI
 * navigateur, la DÉCISION de navigation corrigée : depuis un focus ville, le
 * clic « Province » doit produire une navigation vers le niveau `region`
 * (préservant le filtre), au lieu de laisser l'URL sur `city` (cause du
 * « coincé » au reload). C'est exactement la logique extraite et câblée dans
 * SignauxMapView.handleGeoLevelClick.
 */

const HARNESS = "/e2e-qa/harness/geo-level.html";

test.describe("Dézoom niveau géo (logique navigateur)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS);
    await expect(page.locator("#ready")).toHaveText("ready");
  });

  test("focus ville → Province : navigue vers region (URL province persistée)", async ({
    page,
  }) => {
    const nav = await page.evaluate(() =>
      window.__buildGeoLevelNavigation({
        target: "Province",
        current: "Ville",
        hasSelectedCity: true,
        mode: "signal",
        subsetKey: "z|m",
      }),
    );

    // Le dézoom DOIT produire une navigation région (pas null, pas city).
    expect(nav).not.toBeNull();
    expect(nav).toMatchObject({
      level: "region",
      state: { mode: "signal", filters: { subset: ["z", "m"] } },
    });
  });

  test("focus ZONE → Province : navigue aussi vers region", async ({ page }) => {
    const nav = await page.evaluate(() =>
      window.__buildGeoLevelNavigation({
        target: "Province",
        current: "Zone",
        hasSelectedCity: true,
        subsetKey: "z|m|p",
      }),
    );
    expect(nav).toMatchObject({ level: "region" });
    expect((nav as { state: { filters: { subset: string[] } } }).state.filters
      .subset).toEqual(["z", "m", "p"]);
  });

  test("clic sur le niveau déjà actif → no-op (pas de navigation)", async ({
    page,
  }) => {
    const nav = await page.evaluate(() =>
      window.__buildGeoLevelNavigation({
        target: "Province",
        current: "Province",
        hasSelectedCity: false,
      }),
    );
    expect(nav).toBeNull();
  });

  test("retour Ville depuis Zone → no-op (URL ville déjà posée par selectCity)", async ({
    page,
  }) => {
    const nav = await page.evaluate(() =>
      window.__buildGeoLevelNavigation({
        target: "Ville",
        current: "Zone",
        hasSelectedCity: true,
      }),
    );
    expect(nav).toBeNull();
  });
});
