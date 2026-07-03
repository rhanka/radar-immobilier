import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — bug Steve : critère du « Focus 30 » (vue Sources / Console).
 *
 * AVANT : focus = priorityRank ≤ 30 (distance à Montréal) → des villes proches
 * SANS signal (Kirkland rang 30, Brossard rang 12) restaient listées en
 * Focus 30, et Mont-Tremblant (13 signaux, rang proximité 351) disparaissait.
 *
 * APRÈS (prouvé ici au rendu réel) : focus = villes À SIGNAUX
 * (`computeFocusScope`, rang par nombre de signaux). Le harnais monte
 * SourceConsole avec 3 villes à signaux + 2 villes proches sans signal.
 */

const HARNESS = "/e2e-qa/harness/focus-scope.html";

/** Noms de villes rendus dans le corps de la table. */
async function listedCities(page: import("@playwright/test").Page) {
  return page.locator("tbody td .font-medium").allTextContents();
}

test.describe("SourceConsole — Focus 30 = villes à signaux (rendu navigateur)", () => {
  test("défaut Province : les 5 villes listées (dont les sans-signal)", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await page.getByTestId("console-count").waitFor({ state: "visible" });
    const names = await listedCities(page);
    expect(names.sort()).toEqual(
      ["Brossard", "Kirkland", "Léry", "Mont-Tremblant", "Saint-Eustache"].sort(),
    );
  });

  test("Focus 30 : Mont-Tremblant (loin, 13 signaux) LISTÉE ; Kirkland/Brossard (proches, 0 signal) EXCLUES", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await page.getByRole("button", { name: "Focus 30" }).click();

    const names = await listedCities(page);
    // Les villes à signaux restent — Mont-Tremblant incluse malgré rang 351.
    expect(names.sort()).toEqual(["Léry", "Mont-Tremblant", "Saint-Eustache"].sort());
    // Les proches SANS signal sont sorties (l'ancien bug les gardait).
    expect(names).not.toContain("Kirkland");
    expect(names).not.toContain("Brossard");
    await expect(page.getByTestId("console-count")).toContainText("3 villes");

    // Badge = rang par NOMBRE DE SIGNAUX (221 > 28 > 13), pas la proximité :
    // Mont-Tremblant est #3 (et surtout PAS #351).
    const mtRow = page.locator("tbody tr", { hasText: "Mont-Tremblant" });
    await expect(mtRow.locator(".text-\\[10px\\]").first()).toHaveText("#3");
  });

  test("retour Province : la liste complète revient", async ({ page }) => {
    await page.goto(HARNESS);
    await page.getByRole("button", { name: "Focus 30" }).click();
    await page.getByRole("button", { name: "Province (1104)" }).click();
    expect((await listedCities(page)).length).toBe(5);
  });
});
