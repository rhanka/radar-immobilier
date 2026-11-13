import { expect, test as base, type Page } from "@playwright/test";
import { dedicatedCdpPage } from "./url-filters-cdp.mjs";

// Attach only a fresh tab on the authorized CDP endpoint. Always close it.
const cdpTest = base.extend<{ page: Page }>({
  page: async ({ baseURL }, use) => {
    const connection = await dedicatedCdpPage("http://127.0.0.1:9333");
    try {
      await connection.page.setViewportSize({ width: 1440, height: 1000 });
      await connection.page.bringToFront();
      // A CDP page has no Playwright context baseURL; resolve harness URLs here.
      await connection.page.goto(new URL("/e2e-qa/harness/rail-filter.html", baseURL).href);
      await use(connection.page);
    } finally {
      await connection.close();
    }
  },
});
// Ordinary QA/CI uses its configured browser. This lane uses CDP exclusively.
const test = process.env.SIGNALS_PERIOD_CDP === "1" ? cdpTest : base;

test("should renew the maximum when reopening the closed period menu", async ({ page }) => {
  if (process.env.SIGNALS_PERIOD_CDP !== "1") await page.goto("/e2e-qa/harness/rail-filter.html");
  const trigger = page.getByRole("button", { name: /^Période des signaux/ });
  for (const [instant, label] of [
    ["2026-03-31T16:00:00Z", "Dernier mois"],
    ["2026-04-01T16:00:00Z", "Dernière semaine"],
  ]) {
    await page.clock.setFixedTime(new Date(instant));
    await trigger.click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await expect(page.locator("#current-range-end")).toHaveText(String(Date.parse(instant)));
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
});

test("should change the signal period with real mouse clicks on every preset", async ({ page }) => {
  if (process.env.SIGNALS_PERIOD_CDP !== "1") {
    await page.goto("/e2e-qa/harness/rail-filter.html");
  }
  const trigger = page.getByRole("button", { name: /^Période des signaux/ });
  for (const [label, token] of [
    ["6 derniers mois", "6mo"],
    ["Dernier mois", "1mo"],
    ["3 derniers mois", "3mo"],
    ["12 derniers mois", "12mo"],
    ["Illimité", "all"],
    ["Dernière semaine", "7d"],
  ]) {
    await trigger.click();
    const option = page.getByRole("option", { name: label, exact: true });
    await expect(option).toBeVisible({ timeout: 1800 });
    // Prove the browser hit test reaches the option, then use native input.
    expect(await option.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(
        rect.x + rect.width / 2, rect.y + rect.height / 2,
      ));
    })).toBe(true);
    await option.click();
    await expect(page.locator("#current-period")).toHaveText(token, { timeout: 1800 });
    await expect(trigger).toContainText(label, { timeout: 1800 });
    await expect(option).toHaveCount(0, { timeout: 1800 });
  }
});
