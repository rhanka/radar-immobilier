import { expect, seed, test } from "./fixtures";

test("geo: the géo view renders the seeded zones and lots", async ({ page }) => {
  await page.goto("/#/geo");
  const select = page.locator("#geo-city-select");
  await expect(select).toBeVisible();
  await select.selectOption(seed.city);
  const counters = page.getByText("Données chargées").locator("..");
  await expect(counters.getByText("Zones").locator("..")).toContainText(String(seed.zones));
  await expect(counters.getByText("Lots").locator("..")).toContainText(String(seed.lots));
});
