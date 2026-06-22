import { expect, test } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Bug #1 (header DS) + #2 (police Inter app-wide).
 *
 * On vérifie le RENDU CALCULÉ réel (getComputedStyle), pas des marqueurs de
 * bundle : la nav doit utiliser le vrai style DS `st-appHeader__navLink`
 * (état actif = SOULIGNEMENT border-bottom non transparent) et la police DS
 * « Inter » doit être réellement appliquée (token --st-font-sans chargé).
 */
test.describe("Header DS + police Inter (rendu calculé)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticated(page);
    await page.goto("/");
    // Le chrome n'apparaît qu'après checkSession() : on attend le header DS.
    await page.locator(".st-appHeader__navLink").first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
  });

  test("#1 le lien de nav ACTIF a un soulignement (border-bottom non transparent)", async ({
    page,
  }) => {
    // Le lien actif porte aria-current="page" (vue par défaut = "signaux").
    const active = page.locator('.st-appHeader__navLink[aria-current="page"]');
    await expect(active).toBeVisible();

    const borderColor = await active.evaluate(
      (el) => getComputedStyle(el).borderBottomColor,
    );
    const borderStyle = await active.evaluate(
      (el) => getComputedStyle(el).borderBottomStyle,
    );

    // Soulignement DS : couleur résolue, NON transparente, style solid.
    expect(borderStyle).toBe("solid");
    expect(borderColor).not.toBe("transparent");
    expect(borderColor).not.toBe("rgba(0, 0, 0, 0)");

    // Un lien NON actif doit, lui, rester transparent (preuve que l'état actif
    // est bien le DS et non un style uniforme appliqué partout).
    const inactive = page
      .locator('.st-appHeader__navLink:not([aria-current="page"])')
      .first();
    const inactiveColor = await inactive.evaluate(
      (el) => getComputedStyle(el).borderBottomColor,
    );
    expect(["transparent", "rgba(0, 0, 0, 0)"]).toContain(inactiveColor);
  });

  test("#1 le lien de nav n'a PAS de font-family bespoke (hérite du DS)", async ({
    page,
  }) => {
    const link = page.locator(".st-appHeader__navLink").first();
    const linkFont = await link.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    // La police calculée du lien doit commencer par Inter (héritée du token DS),
    // pas une police système substituée par une surcharge bespoke.
    expect(linkFont.split(",")[0].replace(/["']/g, "").trim()).toBe("Inter");
  });

  test("#2 la police DS « Inter » est appliquée app-wide (body computed)", async ({
    page,
  }) => {
    const bodyFont = await page.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    );
    expect(bodyFont.split(",")[0].replace(/["']/g, "").trim()).toBe("Inter");

    // La fonte doit être réellement CHARGÉE (Google Fonts @import), pas seulement
    // déclarée : document.fonts confirme qu'un face Inter est disponible.
    const interLoaded = await page.evaluate(async () => {
      await (document as Document & { fonts: FontFaceSet }).fonts.ready;
      return (document as Document & { fonts: FontFaceSet }).fonts.check(
        "16px Inter",
      );
    });
    expect(interLoaded).toBe(true);
  });
});
