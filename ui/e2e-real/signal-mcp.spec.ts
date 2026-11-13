import { expect, openSeededCity, seed, test } from "./fixtures";

test("MCP provenance and free user notes persist on the signal card", async ({ page }) => {
  await openSeededCity(page);
  const card = page.locator(`[data-signal-node="${seed.signals[0]!.id}"]`);
  await expect(card.getByText("MCP · e2e-mcp-model · validé humain")).toBeVisible({ timeout: 2000 });
  await expect(card.getByText("MCP · e2e-mcp-model · validé auto")).toBeVisible();
  await expect(card.getByText("MCP browser note", { exact: true })).toBeVisible();
  await expect(card.locator(".signal-notes b")).toHaveCount(0);
  await card.getByLabel("Note libre").fill("User browser note");
  const response = page.waitForResponse((res) => res.url().endsWith("/annotations") && res.request().method() === "POST");
  await card.getByRole("button", { name: "Ajouter la note" }).click();
  expect((await response).status()).toBe(201);
  await expect(card.getByText("User browser note", { exact: true })).toBeVisible({ timeout: 2000 });
  await openSeededCity(page);
  await expect(card.getByText("User browser note", { exact: true })).toBeVisible();
});
