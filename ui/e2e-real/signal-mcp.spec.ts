import { expect, openSeededCity, seed, test } from "./fixtures";

test.skip(process.env.E2E_MCP_SEEDED !== "1", "Requires the dedicated MCP browser seed");

test("MCP provenance and free user notes persist on the signal card", async ({ page }) => {
  await openSeededCity(page);
  const card = page.locator(`[data-signal-node="${seed.signals[0]!.id}"]`);
  await expect(card.getByText("MCP · e2e-mcp-model · à confirmer")).toBeVisible({ timeout: 2000 });
  await expect(card.getByText("MCP · e2e-mcp-model · validé auto")).toBeVisible({ timeout: 2000 });
  await expect(card.getByText("MCP browser note", { exact: true })).toBeVisible({ timeout: 2000 });
  await expect(card.locator(".signal-notes b")).toHaveCount(0);
  await card.getByLabel("Note libre").fill("User browser note");
  const response = page.waitForResponse((res) => res.url().endsWith("/annotations") && res.request().method() === "POST");
  await card.getByRole("button", { name: "Ajouter la note" }).click();
  expect((await response).status()).toBe(201);
  await expect(card.getByText("User browser note", { exact: true })).toBeVisible({ timeout: 2000 });
  await openSeededCity(page);
  await expect(card.getByText("User browser note", { exact: true })).toBeVisible({ timeout: 2000 });
  const decision = page.waitForResponse((res) => res.url().endsWith("/annotations/decision") && res.request().method() === "POST");
  await card.getByRole("button", { name: "Confirmer la classification MCP" }).click();
  const confirmed = await decision;
  expect(confirmed.status()).toBe(201);
  expect((await confirmed.json()).current).toMatchObject({ source: "manual", validation: "human", verdict: "up", linked_event_id: expect.any(String) });
  await openSeededCity(page);
  await expect(card.getByText("MCP · e2e-mcp-model · à confirmer")).toHaveCount(0);
  await card.getByRole("button", { name: /Classement/ }).click();
  const reclassification = page.waitForResponse((res) => res.url().endsWith("/annotations/decision") && res.request().method() === "POST");
  await page.getByRole("menuitem", { name: "Non classé", exact: true }).click();
  const cleared = await reclassification;
  expect(cleared.status()).toBe(201);
  expect((await cleared.json()).current).toMatchObject({ source: "manual", classe: "non_classe" });
});

test("Non classé persists an explicit manual override of a pending MCP class", async ({ page }) => {
  await openSeededCity(page);
  const card = page.locator(`[data-signal-node="${seed.signals[1]!.id}"]`);
  await expect(card.getByText("MCP · e2e-mcp-model · à confirmer")).toBeVisible({ timeout: 2000 });
  await card.getByRole("button", { name: /Classement/ }).click();
  const decision = page.waitForResponse((res) => res.url().endsWith("/annotations/decision") && res.request().method() === "POST");
  await page.getByRole("menuitem", { name: "Non classé", exact: true }).click();
  const saved = await decision;
  expect(saved.status()).toBe(201);
  expect((await saved.json()).current).toMatchObject({ source: "manual", validation: "human", classe: "non_classe", linked_event_id: expect.any(String) });
  await openSeededCity(page);
  await expect(card.getByRole("button", { name: /Classement.*Non classé/ })).toBeVisible({ timeout: 2000 });
});
