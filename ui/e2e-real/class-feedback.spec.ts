import { expect, openSeededCity, seed, test } from "./fixtures";

for (const [index, theme] of ["light", "dark"].entries()) {
  test(`AI feedback: positive validation persists in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
    await openSeededCity(page);
    const card = page.locator(`[data-signal-node="${seed.signals[index]!.id}"]`);
    await expect(card.getByText(/IA · gpt-6-astra/)).toBeVisible();
    const response = page.waitForResponse((res) => res.url().endsWith("/class-feedback") && res.request().method() === "POST");
    await card.getByRole("button", { name: "Valider l’annotation IA" }).click();
    expect((await response).status()).toBe(200);
    await expect(card.getByText("Validé par un humain")).toBeVisible({ timeout: 2000 });
    await openSeededCity(page);
    await expect(card.getByText("Validé par un humain")).toBeVisible();
    await expect(card.getByRole("button", { name: "Valider l’annotation IA" })).toHaveCount(0);
  });
}

test("AI feedback: negative requires a different class and reason; Cancel writes nothing", async ({ page, network }) => {
  await openSeededCity(page);
  const card = page.locator(`[data-signal-node="${seed.signals[2]!.id}"]`);
  await card.getByRole("button", { name: "Corriger l’annotation IA" }).click();
  const form = page.getByRole("form", { name: "Reclassement obligatoire" });
  await expect(form.getByRole("button", { name: "Reclasser" })).toBeDisabled();
  await expect(form.getByRole("option", { name: "Pertinent", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Annuler" }).click();
  expect(network.filter((entry) => entry.method === "POST" && entry.url.endsWith("/class-feedback"))).toHaveLength(0);
  await page.emulateMedia({ colorScheme: "dark" });
  await card.getByRole("button", { name: "Corriger l’annotation IA" }).click();
  await form.getByLabel("Nouvelle classe").selectOption("a_surveiller");
  await expect(form.getByRole("button", { name: "Reclasser" })).toBeDisabled();
  await form.getByLabel("Motif du reclassement").selectOption("S-PLANIFIE");
  await form.getByLabel("Commentaire facultatif").fill("À vérifier au prochain conseil.");
  const response = page.waitForResponse((res) => res.url().endsWith("/class-feedback") && res.request().method() === "POST");
  await form.getByRole("button", { name: "Reclasser" }).click();
  expect((await response).status()).toBe(200);
  await expect(card.getByText("Reclassé par un humain")).toBeVisible({ timeout: 2000 });
});
