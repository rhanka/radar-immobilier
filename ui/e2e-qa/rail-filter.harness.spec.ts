import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — Bug #3 (persistance du filtre du vivier B au reload).
 *
 * Deux défauts de câblage, prouvés au rendu réel :
 *
 *  (A) Au MONTAGE, le rail propageait `onFilterChange(activeKey)` via un bloc
 *      réactif `$: onFilterChange(activeKey)` → le parent écrivait alors
 *      URL+localStorage avec le DÉFAUT, écrasant un filtre restauré depuis
 *      l'URL. La propagation ne doit venir QUE d'un toggle utilisateur.
 *
 *  (B) Quand le parent recalcule `initialSubsetKey` au reload (URL > localStorage
 *      > défaut) APRÈS le 1er rendu, le rail ne resynchronisait PAS ses cases
 *      (let initialisés une seule fois) → les cases restaient sur le défaut,
 *      le filtre restauré était perdu visuellement.
 */

const HARNESS = "/e2e-qa/harness/rail-filter.html";

// Le composant DS Checkbox : on cible l'input via le label associé. `exact`
// car l'axe « Résidentiel » partage une sous-chaîne avec l'exclusion « Exclure
// PIIA sans projet résidentiel » (sinon violation du strict mode Playwright).
function checkbox(page: import("@playwright/test").Page, label: string) {
  return page.getByRole("checkbox", { name: label, exact: true });
}

test.describe("SignauxRail — persistance filtre (rendu navigateur)", () => {
  test("(A) ne propage AUCUN filtre au montage (pas d'écrasement de l'URL)", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    // Laisse le rendu + microtâches réactives se stabiliser.
    await page.locator("#emit-count").waitFor({ state: "visible" });
    await page.waitForTimeout(300);

    // Aucune propagation tant que l'utilisateur n'a pas touché un toggle.
    await expect(page.locator("#emit-count")).toHaveText("0");
  });

  test("(B) resynchronise les cases quand initialSubsetKey change au reload", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await page.locator("#set-from-url").waitFor({ state: "visible" });

    // État initial : défaut vivier-v2 → les 3 axes B cochés.
    await expect(checkbox(page, "Zonage")).toBeChecked();
    await expect(checkbox(page, "Résidentiel")).toBeChecked();
    await expect(checkbox(page, "Précoce")).toBeChecked();

    // Le parent restaure depuis l'URL "vivier-v2|-p" (reload) : Précoce se DÉCOCHE.
    await page.locator("#set-from-url").click();
    await expect(page.locator("#current-initial")).toHaveText("vivier-v2|-p");

    await expect(checkbox(page, "Zonage")).toBeChecked();
    await expect(checkbox(page, "Résidentiel")).toBeChecked();
    await expect(checkbox(page, "Précoce")).not.toBeChecked();
  });

  test("propage la bonne clé au toggle utilisateur", async ({ page }) => {
    await page.goto(HARNESS);
    await checkbox(page, "Précoce").waitFor({ state: "visible" });

    // Décoche « Précoce » depuis le défaut vivier-v2 → propage "vivier-v2|-p".
    await checkbox(page, "Précoce").click();
    await expect(page.locator("#emitted-log")).toContainText("vivier-v2|-p");
  });
});
