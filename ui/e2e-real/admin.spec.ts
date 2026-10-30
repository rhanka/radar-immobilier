import { expect, seed, stateFor, test } from "./fixtures";

test.describe("admin: as admin", () => {
  test.use({ storageState: stateFor("admin") });
  test("Administration lists the seeded users", async ({ page }) => {
    await page.goto("/#/admin");
    await expect(page.getByText("3 validés")).toBeVisible();
    await page.getByRole("button", { name: "Tous les comptes" }).click();
    await expect(page.getByText(seed.people.member.email).first()).toBeVisible();
    await expect(page.getByText(seed.people.outsider.email).first()).toBeVisible();
  });
});

test.describe("admin: as member", () => {
  test.use({ storageState: stateFor("member") });
  test("the same screen shows the refusal state", async ({ page }) => {
    await page.goto("/#/admin");
    await expect(page.getByText("Chargement impossible")).toBeVisible();
    await expect(page.getByText(seed.people.outsider.email)).toHaveCount(0);
  });
});
