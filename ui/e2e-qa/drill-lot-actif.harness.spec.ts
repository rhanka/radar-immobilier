import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — règle 5 du drill Ville→Zone→Lot (nav owner, item
 * 01KZEG78ZFDFMMSKCX3362NPYH) : au dernier niveau du drill, un lot focusé est
 * ÉPINGLÉ dans un panneau « Lot actif » (miroir de « Ville active » / « Zone
 * active »). On PROUVE le comportement RENDU en vrai Chromium (headless
 * jetable, aucun docker) via le harnais lot-fiche-geo, qui pré-focus un lot
 * servi par geo : le pin `.sel-lot-head` doit s'afficher avec le n° de lot, un
 * champ prioritaire (superficie) et le détail dépliable — pas un grep de bundle.
 */

const HARNESS = "/e2e-qa/harness/lot-fiche-geo.html";

test.describe("Drill règle 5 — pin « Lot actif » (comportement rendu)", () => {
  test("lot focusé → panneau « Lot actif » épinglé (n° + superficie + détail)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 460, height: 1100 });
    await page.goto(`${HARNESS}?lot=full`);

    const pin = page.getByTestId("sel-lot-head");
    await expect(pin).toBeVisible({ timeout: 10_000 });
    // Panneau pinné « Lot actif », miroir de Zone/Ville active.
    await expect(pin).toContainText("Lot actif");
    // Le lot focusé (servi geo) est identifié par son n°.
    await expect(pin).toContainText("1 000 001");
    // Champ prioritaire du pin (superficie réelle servie).
    await expect(pin).toContainText("Superficie");
    // Détail dépliable présent (miroir du pin Zone active).
    await expect(page.getByTestId("sel-lot-head-more")).toBeAttached();
  });
});
