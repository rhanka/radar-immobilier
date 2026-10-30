import { expect, test } from "./fixtures";

// The opportunity funnel reads the domain dossiers; the current UI has no
// signal-to-funnel link, so this journey asserts the funnel renders its
// dossiers on the real stack without any retired reader (network guard).
test("opportunite: the opportunity funnel renders its dossiers", async ({ page }) => {
  await page.goto("/#/opportunity");
  await expect(page.locator("main, body").getByText(/Valleyfield/i).first()).toBeVisible();
});
