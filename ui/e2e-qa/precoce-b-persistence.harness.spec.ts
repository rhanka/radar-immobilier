import { expect, test } from "@playwright/test";

const HARNESS = "/e2e-qa/harness/precoce-b-persistence.html";
const precoce = (page: import("@playwright/test").Page) =>
  page.getByRole("checkbox", { name: "Signaux précoces" });

test.describe("B Précoce default and session persistence (browser render)", () => {
  test("direct navigation and reload of canonical vivier-v2 check Précoce", async ({ page }) => {
    await page.goto(HARNESS);
    await expect(precoce(page)).toBeChecked();
    await page.reload();
    await expect(precoce(page)).toBeChecked();
  });

  test("an explicit uncheck survives a same-mode city reconcile", async ({ page }) => {
    await page.goto(HARNESS);
    await precoce(page).click();
    await expect(precoce(page)).not.toBeChecked();
    await expect(page.locator("#emitted")).toHaveText("vivier-v2|-p");
    await page.locator("#reconcile-city").click();
    await expect(page.locator("#initial-key")).toHaveText("vivier-v2");
    await expect(precoce(page)).not.toBeChecked();
  });
});
