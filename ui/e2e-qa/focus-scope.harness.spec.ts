import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — critère du focus (vue Sources / Console).
 *
 * AVANT (bug no 1, Steve) : focus = priorityRank ≤ 30 (distance à Montréal) →
 * des villes proches SANS signal (Kirkland rang 30, Brossard rang 12) restaient
 * listées, et Mont-Tremblant (rang proximité 351) disparaissait.
 * AVANT (bug no 2) : focus = top 30 par NOMBRE de signaux → une ville à gros
 * volume SANS signal prioritaire (Lyster, 400 signaux) était focus à tort.
 *
 * APRÈS (prouvé ici au rendu réel) : focus = villes portant les signaux
 * PRIORITAIRES z∩m∩p (zonage ∩ multifamilial 4+ ∩ précoce — la cohorte « 33 »
 * de l'axe « 30 villes / 33 signaux précoces », `computeFocusScope`). Le
 * harnais monte SourceConsole avec 3 villes à signaux prioritaires + 1 ville à
 * gros volume sans prioritaire + 2 villes proches sans signal.
 */

const HARNESS = "/e2e-qa/harness/focus-scope.html";
const SEG_FOCUS = "Villes à signaux précoces";

/** Noms de villes rendus dans le corps de la table. */
async function listedCities(page: import("@playwright/test").Page) {
  return page.locator("tbody td .font-medium").allTextContents();
}

test.describe("SourceConsole — focus = villes à signaux prioritaires z∩m∩p (rendu navigateur)", () => {
  test("défaut Province : les 6 villes listées (dont sans-signal et volume-sans-prioritaire)", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await page.getByTestId("console-count").waitFor({ state: "visible" });
    const names = await listedCities(page);
    expect(names.sort()).toEqual(
      [
        "Brossard",
        "Kirkland",
        "Lyster",
        "Mont-Tremblant",
        "Saint-Amable",
        "Sainte-Catherine",
      ].sort(),
    );
  });

  test("focus : Mont-Tremblant (loin, 2 prioritaires) LISTÉE ; Kirkland/Brossard (0 signal) ET Lyster (400 signaux, 0 prioritaire) EXCLUES", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await page.getByRole("button", { name: SEG_FOCUS }).click();

    const names = await listedCities(page);
    // Les villes à signaux PRIORITAIRES restent — Mont-Tremblant incluse
    // malgré son rang proximité 351.
    expect(names.sort()).toEqual(
      ["Mont-Tremblant", "Saint-Amable", "Sainte-Catherine"].sort(),
    );
    // Les proches SANS signal sont sorties (bug no 1)…
    expect(names).not.toContain("Kirkland");
    expect(names).not.toContain("Brossard");
    // …et le volume brut ne suffit pas (bug no 2) : Lyster est sortie aussi.
    expect(names).not.toContain("Lyster");
    await expect(page.getByTestId("console-count")).toContainText("3 villes");

    // Badge = rang par nb de signaux PRIORITAIRES (2 > 1 = 1) : Mont-Tremblant
    // est #1 (et surtout PAS #351, ni un rang par volume de signaux).
    const mtRow = page.locator("tbody tr", { hasText: "Mont-Tremblant" });
    await expect(mtRow.locator(".text-\\[10px\\]").first()).toHaveText("#1");
  });

  test("retour Province : la liste complète revient", async ({ page }) => {
    await page.goto(HARNESS);
    await page.getByRole("button", { name: SEG_FOCUS }).click();
    await page.getByRole("button", { name: "Province (1104)" }).click();
    expect((await listedCities(page)).length).toBe(6);
  });
});
