import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — Bug #3 (persistance du filtre z/m/p au reload).
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

// Le composant DS Checkbox : on cible l'input via le label associé.
function checkbox(page: import("@playwright/test").Page, label: string) {
  return page.getByRole("checkbox", { name: label });
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

    // État initial : défaut z|m|p → les 3 cases cochées.
    await expect(checkbox(page, "Zonage uniquement")).toBeChecked();
    await expect(checkbox(page, "Multifamilial 4+")).toBeChecked();
    await expect(checkbox(page, "Signaux précoces")).toBeChecked();

    // Le parent restaure depuis l'URL "z|m" (reload) : p doit se DÉCOCHER.
    await page.locator("#set-from-url").click();
    await expect(page.locator("#current-initial")).toHaveText("z|m");

    await expect(checkbox(page, "Zonage uniquement")).toBeChecked();
    await expect(checkbox(page, "Multifamilial 4+")).toBeChecked();
    await expect(checkbox(page, "Signaux précoces")).not.toBeChecked();
  });

  test("propage la bonne clé au toggle utilisateur", async ({ page }) => {
    await page.goto(HARNESS);
    await checkbox(page, "Signaux précoces").waitFor({ state: "visible" });

    // Décoche « Signaux précoces » (p) depuis le défaut z|m|p → propage "z|m".
    await checkbox(page, "Signaux précoces").click();
    await expect(page.locator("#emitted-log")).toContainText("z|m");
  });
});
