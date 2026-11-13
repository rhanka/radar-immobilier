import { expect, test as base, type Page } from "@playwright/test";
import { dedicatedCdpPage } from "./url-filters-cdp.mjs";

// Attach only a fresh tab on the authorized CDP endpoint. Always close it.
const test = base.extend<{ page: Page }>({
  page: async ({}, use) => {
    const connection = await dedicatedCdpPage("http://127.0.0.1:9333");
    try {
      await connection.page.setViewportSize({ width: 1440, height: 1000 });
      await connection.page.bringToFront();
      await use(connection.page);
    } finally {
      await connection.close();
    }
  },
});

test("should change the signal period with real mouse clicks on every preset", async ({ page }) => {
  await page.goto("http://127.0.0.1:15938/e2e-qa/harness/rail-filter.html");
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
