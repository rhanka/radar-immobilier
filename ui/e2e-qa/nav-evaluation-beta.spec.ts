import { expect, test } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * QA NAVIGATEUR — Évaluation masquée de la nav (feature beta Ctrl+Shift+X).
 *
 * Comportement RENDU vérifié (pas de marqueurs de bundle) :
 *   1. Par défaut la nav principale n'a QUE Signaux + Sources (2 liens) ;
 *      « Évaluation » est absente du header.
 *   2. Ctrl+Shift+X révèle « Évaluation » dans la nav (3 liens), navigue vers
 *      la vue Évaluation, et pose l'indicateur « bêta » (::after tokens DS).
 *   3. Le flag est PERSISTANT : après reload, Évaluation reste visible
 *      (localStorage `radar.beta.evaluation`).
 *   4. Re-bascule : Évaluation disparaît de la nav et on revient sur Signaux.
 *   5. Le raccourci est IGNORÉ quand le focus est dans un champ de saisie.
 *   6. La route directe `#/evaluation` reste valide même flag OFF.
 */
test.describe("Nav — Évaluation beta (Ctrl+Shift+X)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticated(page);
    await page.goto("/");
    await page.locator(".st-appHeader__navLink").first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
  });

  test("par défaut : 2 liens (Signaux/Sources), Évaluation absente", async ({
    page,
  }, testInfo) => {
    const navLinks = page.locator("a.st-appHeader__navLink");
    await expect(navLinks).toHaveCount(2);
    await expect(navLinks.nth(0)).toHaveText("Signaux");
    await expect(navLinks.nth(1)).toHaveText("Sources");
    await expect(
      page.locator('a.st-appHeader__navLink[href="#/evaluation"]'),
    ).toHaveCount(0);

    await page.screenshot({
      path: testInfo.outputPath("nav-default-sans-evaluation.png"),
    });
  });

  test("Ctrl+Shift+X : révèle Évaluation (3 liens), navigue et pose le badge bêta", async ({
    page,
  }, testInfo) => {
    await page.keyboard.press("Control+Shift+X");

    const evaluation = page.locator(
      'a.st-appHeader__navLink[href="#/evaluation"]',
    );
    await expect(evaluation).toBeVisible();
    await expect(page.locator("a.st-appHeader__navLink")).toHaveCount(3);

    // Navigation directe vers la vue révélée : hash + item actif.
    await expect(page).toHaveURL(/#\/evaluation$/);
    await expect(evaluation).toHaveAttribute("aria-current", "page");

    // Indicateur « bêta » : contenu du ::after RENDU (tokens DS).
    const badge = await evaluation.evaluate(
      (el) => getComputedStyle(el, "::after").content,
    );
    expect(badge).toContain("bêta");

    // Persistance du flag.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("radar.beta.evaluation"),
    );
    expect(stored).toBe("true");

    await page.screenshot({
      path: testInfo.outputPath("nav-beta-evaluation-visible.png"),
    });
  });

  test("le flag persiste au reload (Évaluation reste dans la nav)", async ({
    page,
  }) => {
    await page.keyboard.press("Control+Shift+X");
    await expect(
      page.locator('a.st-appHeader__navLink[href="#/evaluation"]'),
    ).toBeVisible();

    await page.reload();
    await page.locator(".st-appHeader__navLink").first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await expect(
      page.locator('a.st-appHeader__navLink[href="#/evaluation"]'),
    ).toBeVisible();
    await expect(page.locator("a.st-appHeader__navLink")).toHaveCount(3);
  });

  test("re-bascule : Évaluation disparaît et on revient sur Signaux", async ({
    page,
  }) => {
    await page.keyboard.press("Control+Shift+X");
    await expect(page).toHaveURL(/#\/evaluation$/);

    await page.keyboard.press("Control+Shift+X");
    await expect(
      page.locator('a.st-appHeader__navLink[href="#/evaluation"]'),
    ).toHaveCount(0);
    await expect(page.locator("a.st-appHeader__navLink")).toHaveCount(2);
    await expect(page).toHaveURL(/#\/signaux$/);
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("radar.beta.evaluation"),
    );
    expect(stored).toBeNull();
  });

  test("le raccourci est ignoré quand le focus est dans un champ de saisie", async ({
    page,
  }) => {
    // Champ de saisie injecté et focalisé : la frappe part du <input> réel
    // (event.target), exactement le cas « l'utilisateur tape dans un champ ».
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "qa-focus-input";
      document.body.appendChild(input);
      input.focus();
    });
    await page.keyboard.press("Control+Shift+X");

    await expect(
      page.locator('a.st-appHeader__navLink[href="#/evaluation"]'),
    ).toHaveCount(0);
    await expect(page.locator("a.st-appHeader__navLink")).toHaveCount(2);

    // Hors du champ, le même raccourci fonctionne (contre-épreuve).
    await page.evaluate(() => {
      (document.getElementById("qa-focus-input") as HTMLInputElement).blur();
    });
    await page.keyboard.press("Control+Shift+X");
    await expect(
      page.locator('a.st-appHeader__navLink[href="#/evaluation"]'),
    ).toBeVisible();
  });

  test("la route directe #/evaluation reste valide flag OFF (vue accessible)", async ({
    page,
  }) => {
    await page.goto("/#/evaluation");
    // La nav reste SANS Évaluation (flag OFF)…
    await page.locator(".st-appHeader__navLink").first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await expect(page.locator("a.st-appHeader__navLink")).toHaveCount(2);
    // …mais la vue Évaluation est bien rendue (aucun lien actif dans la nav).
    await expect(
      page.locator('a.st-appHeader__navLink[aria-current="page"]'),
    ).toHaveCount(0);
    await expect(page).toHaveURL(/#\/evaluation$/);
  });
});
