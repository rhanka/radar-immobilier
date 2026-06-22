import { expect, test } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Header 100% DS : bloc marque CANONIQUE + menu identité.
 *
 * On vérifie le RENDU réel (DOM + computed), pas des marqueurs de bundle :
 *  - la marque est rendue par le bloc DS `st-appHeader__brand`
 *    (`<img class="st-appHeader__brandMark">` + `__brandName`/`__brandProduct`),
 *    PAS par un snippet/CSS maison (`.topnav-brand`/`.topnav-logo` supprimés) ;
 *  - le menu identité DS s'ouvre, expose ses items (Paramètres) et déclenche le
 *    logout câblé sur le store auth réel ;
 *  - en viewport mobile, le header passe au burger NATIF d'AppHeader et le tiroir
 *    reste DANS le viewport (aucun débordement horizontal — l'ancien risque
 *    « OverflowMenu détourné » est éliminé par `compact`/`drawer` natifs).
 */
test.describe("Header DS — marque canonique + identité (rendu réel)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticated(page);
    await page.goto("/");
    await page.locator(".st-appHeader__navLink").first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
  });

  test("marque rendue par le bloc CANONIQUE DS (pas de logo/CSS maison)", async ({
    page,
  }) => {
    // Bloc marque DS présent (rendu par AppHeader via les props, pas un snippet).
    const brand = page.locator(".st-appHeader__brand");
    await expect(brand).toBeVisible();

    // Logo carré = <img class="st-appHeader__brandMark"> pointant sur l'asset.
    const mark = brand.locator("img.st-appHeader__brandMark");
    await expect(mark).toBeVisible();
    const src = await mark.getAttribute("src");
    expect(src).toContain("radar-logo.svg");

    // Nom + sous-titre via les classes DS canoniques (poids 760 / 650 hérités).
    await expect(brand.locator(".st-appHeader__brandName")).toHaveText("Radar");
    await expect(brand.locator(".st-appHeader__brandProduct")).toHaveText(
      "immobilier",
    );

    // PREUVE d'absence de bloc marque maison : les anciennes classes ne sont plus
    // dans le DOM (snippet `logo` + `.topnav-brand*` supprimés).
    await expect(page.locator(".topnav-brand")).toHaveCount(0);
    await expect(page.locator(".topnav-logo")).toHaveCount(0);
  });

  test("menu identité DS s'ouvre, expose ses items et logout est câblé", async ({
    page,
  }) => {
    const trigger = page.locator(".st-identityMenu__trigger");
    await expect(trigger).toBeVisible();
    // L'avatar affiche les initiales de l'utilisateur mocké (QA User -> QU/Q).
    await expect(trigger).toContainText(/Q/);

    await trigger.click();
    const menu = page.locator(".st-identityMenu__menu");
    await expect(menu).toBeVisible();

    // Items DS publiés (0.34.58) présents.
    await expect(
      menu.locator('[role="menuitem"]', { hasText: "Paramètres" }),
    ).toBeVisible();
    const logout = menu.locator('[role="menuitem"]', {
      hasText: "Se déconnecter",
    });
    await expect(logout).toBeVisible();

    // Logout RÉELLEMENT câblé : le handler onLogout (store auth) appelle
    // GET /api/v1/auth/logout puis recharge vers /. On intercepte l'endpoint
    // EXACT (preuve que ce n'est pas un bouton inerte). Cette route est
    // enregistrée APRÈS le catch-all de mockAuthenticated → elle a priorité.
    let logoutCalled = false;
    await page.route("**/api/v1/auth/logout", (route) => {
      logoutCalled = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await logout.click();
    await expect.poll(() => logoutCalled, { timeout: 5_000 }).toBe(true);
  });

  test("viewport mobile : burger natif + tiroir DANS le viewport (zéro débordement)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });

    // En compact, la nav desktop est masquée et le burger NATIF d'AppHeader paraît.
    const burger = page.locator(".st-appHeader__burgerButton");
    await expect(burger).toBeVisible();

    await burger.click();
    const drawer = page.locator("#st-appHeader-drawer-1, .st-appHeader__drawer");
    await expect(drawer.first()).toBeVisible();

    // Aucun débordement horizontal : la largeur du document ne dépasse PAS le
    // viewport (le tiroir DS est cappé `min(22rem,85vw)`, pas un OverflowMenu
    // détourné qui débordait).
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth - de.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
