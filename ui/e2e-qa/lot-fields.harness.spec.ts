import { expect, test, type Page } from "@playwright/test";
import { measureCityLotFields } from "../../api/src/services/geo/lot-fields-coverage.js";

/**
 * QA NAVIGATEUR — indicateurs « Champs lot » (superficie / adresse / code
 * postal / normes foldées) dans la Console sources ET la scorecard par ville.
 *
 * DONNÉES RÉELLES : l'endpoint `/api/source/coverage/:city/lot-fields` est
 * servi ici par le VRAI service de mesure (`lot-fields-coverage`) exécuté
 * LIVE contre l'API geo (https://api.geo.sent-tech.ca) — les % affichés sont
 * les chiffres réellement servis au moment du run, pas une fixture.
 *
 * Attendus (mesure live du 2026-07-05, validation exhaustive 1102 collections) :
 *   - Delson (3 330 lots)          : superficie 100 %, code postal 100 %,
 *     adresse et normes > 0 % → badges « Servi »/« Partiel », jamais de
 *     « 100 % » fabriqué sur un champ partiel.
 *   - Mont-Tremblant (10 016 lots) : 0 % sur les 4 champs → « 0 % — non
 *     enrichi » + « Non couvert », jamais de vert.
 */

const HARNESS = "/e2e-qa/harness/lot-fields.html";
const GEO_BASE = "https://api.geo.sent-tech.ca";

/** Sert lot-fields via le VRAI service (mesure live geo, jamais fabriquée). */
async function routeLotFieldsThroughRealService(page: Page): Promise<void> {
  await page.route("**/api/source/coverage/*/lot-fields", async (route) => {
    const segments = new URL(route.request().url()).pathname.split("/");
    const citySlug = segments[segments.length - 2] ?? "";
    const measure = await measureCityLotFields(citySlug, GEO_BASE);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(measure ?? { citySlug, available: false }),
    });
  });
}

async function openScorecard(page: Page, cityName: string): Promise<void> {
  await page.goto(HARNESS);
  await page.getByTestId("console-count").waitFor({ state: "visible" });
  await page.locator("tbody td .font-medium", { hasText: cityName }).click();
  await page.getByTestId("scorecard-lot-fields").waitFor({ state: "visible" });
  // Mesure lazy résolue = la note de méthode ou les lignes de champs rendues.
  await page
    .getByTestId("lot-field-superficie")
    .waitFor({ state: "visible", timeout: 20_000 });
}

test.describe("Champs lot — Console + scorecard (mesure LIVE geo)", () => {
  test.beforeEach(async ({ page }) => {
    await routeLotFieldsThroughRealService(page);
  });

  test("la Console porte la colonne « Champs lot » (tri-état, non couvert à froid)", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await page.getByTestId("console-count").waitFor({ state: "visible" });
    await expect(
      page.getByRole("columnheader", { name: "Champs lot" }),
    ).toBeVisible();
    // Bulk froid honnête : cellule « Non couvert » tant que rien n'est mesuré.
    await expect(
      page
        .locator("tbody tr")
        .first()
        .locator(
          '[aria-label="Champs lot (superficie · adresse · code postal · normes) : Non couvert"]',
        ),
    ).toBeVisible();
    await page.screenshot({
      path: "../uat-lot-fields-console.png",
      fullPage: true,
    });
  });

  test("Delson (enrichie) : superficie et code postal 100 % « Servi », méthode échantillon déclarée", async ({
    page,
  }) => {
    await openScorecard(page, "Delson");
    const block = page.getByTestId("scorecard-lot-fields");

    // Champs complets sur l'échantillon : 100 % + « Servi ».
    await expect(block.getByTestId("lot-field-superficie")).toContainText(
      "100 % des lots",
    );
    await expect(block.getByTestId("lot-field-superficie")).toContainText(
      "Servi",
    );
    await expect(block.getByTestId("lot-field-code-postal")).toContainText(
      "100 % des lots",
    );

    // Adresse et normes réellement servies (> 0 %) — le % exact vient du live.
    await expect(block.getByTestId("lot-field-adresse")).toContainText(
      /[1-9]\d? % des lots|100 % des lots/,
    );
    await expect(block.getByTestId("lot-field-normes")).toContainText(
      /[1-9]\d? % des lots|100 % des lots/,
    );
    await expect(block.getByTestId("lot-field-normes")).not.toContainText(
      "non enrichi",
    );

    // Méthode DÉCLARÉE : 3 330 lots > 450 → échantillon annoncé, jamais masqué.
    await expect(block).toContainText("échantillon de 450 lots");

    await page.screenshot({
      path: "../uat-lot-fields-delson.png",
      fullPage: true,
    });
  });

  test("Mont-Tremblant (non enrichie) : « 0 % — non enrichi » + « Non couvert » sur les 4 champs", async ({
    page,
  }) => {
    await openScorecard(page, "Mont-Tremblant");
    const block = page.getByTestId("scorecard-lot-fields");

    for (const key of ["superficie", "adresse", "code-postal", "normes"]) {
      const row = block.getByTestId(`lot-field-${key}`);
      await expect(row).toContainText("0 % — non enrichi");
      await expect(row).toContainText("Non couvert");
      // Anti-survente : jamais « Servi » sur un champ vide.
      await expect(row).not.toContainText("Servi");
    }

    await page.screenshot({
      path: "../uat-lot-fields-mont-tremblant.png",
      fullPage: true,
    });
  });
});
