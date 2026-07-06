import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — WP3 LOT1 : section « Cohérence E2E » de la scorecard.
 *
 * Lane SÉPARÉE de la couverture (badge « Couverture » inchangé) : un 2e
 * badge tri-état (`Cohérent` / `À qualifier` / `Non mesuré`) + 2 arêtes
 * (E0 PV→signaux, E1 signaux→zones avec fraction fiable) + bloqueur +
 * fraîcheur `batch PG · <date>`.
 *
 * `/api/source/consistency` est MOCKÉ (une seule ville dans le snapshot,
 * `mont-tremblant`) : la scorecard « mesurée » la trouve dans la réponse
 * batch, la scorecard « hors focus-30 » n'y figure PAS → `Non mesuré`
 * honnête (jamais un faux 0/100 %, jamais « Non couvert »).
 */

const HARNESS = "/e2e-qa/harness/consistency-scorecard.html";

const CONSISTENCY_RESPONSE = {
  generatedAt: "2026-07-06T00:00:00.000Z",
  cities: [
    {
      citySlug: "mont-tremblant",
      consistency: {
        citySlug: "mont-tremblant",
        mode: "batch-pg",
        generatedAt: "2026-07-06T00:00:00.000Z",
        state: "partial",
        edges: {
          pvSignal: { num: 20, denom: 20, rate: 1, status: "measured" },
          signalZone: {
            num: 9,
            denom: 15,
            rate: 0.6,
            status: "measured",
            reliableNum: 5,
            reliableRate: 0.5556,
            applicability: { num: 15, denom: 20, rate: 0.75, status: "measured" },
          },
        },
        blockers: ["Zone désignée non servie"],
      },
    },
  ],
};

test.describe("WP3 LOT1 — Cohérence E2E (scorecard)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/source/consistency", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CONSISTENCY_RESPONSE),
      });
    });
  });

  test("ville focus-30 mesurée : 2 arêtes + fraction fiable + bloqueur + fraîcheur batch PG", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    const measured = page
      .getByTestId("harness-measured")
      .getByTestId("scorecard-consistency");

    await measured.getByTestId("consistency-freshness").waitFor({ state: "visible" });

    await expect(measured.getByText("Cohérence E2E")).toBeVisible();
    await expect(measured.getByTestId("consistency-state-badge")).toContainText(
      "À qualifier",
    );
    await expect(measured.getByTestId("consistency-pv-signal")).toContainText("20/20");
    await expect(measured.getByTestId("consistency-signal-zone")).toContainText("9/15");
    await expect(measured.getByTestId("consistency-signal-zone")).toContainText("56 %");
    await expect(measured.getByTestId("consistency-blocker")).toContainText(
      "Zone désignée non servie",
    );
    await expect(measured.getByTestId("consistency-freshness")).toContainText("batch PG");
    // Anti-survente : la lane cohérence n'emprunte jamais le vocabulaire couverture.
    await expect(measured).not.toContainText("Non couvert");
  });

  test("ville hors focus-30 (aucun snapshot) : « Non mesuré » honnête, jamais un faux 0/100 %", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    const unmeasured = page
      .getByTestId("harness-unmeasured")
      .getByTestId("scorecard-consistency");

    await unmeasured.getByTestId("consistency-freshness").waitFor({ state: "visible" });

    await expect(unmeasured.getByTestId("consistency-state-badge")).toContainText(
      "Non mesuré",
    );
    await expect(unmeasured.getByTestId("consistency-pv-signal")).toContainText(
      "non mesuré",
    );
    await expect(unmeasured.getByTestId("consistency-signal-zone")).toContainText(
      "non mesuré",
    );
    await expect(unmeasured.getByTestId("consistency-freshness")).toContainText(
      "aucun snapshot pour cette ville",
    );
    await expect(unmeasured).not.toContainText("Non couvert");
    await expect(unmeasured).not.toContainText("100 %");
  });

  test("capture — les deux scénarios côte à côte (mesurée vs non mesurée)", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await page
      .getByTestId("harness-measured")
      .getByTestId("consistency-freshness")
      .waitFor({ state: "visible" });
    await page
      .getByTestId("harness-unmeasured")
      .getByTestId("consistency-freshness")
      .waitFor({ state: "visible" });

    await page.screenshot({
      path: "../uat-consistency-e2e-lot1.png",
      fullPage: true,
    });
  });
});
