import type { Page } from "@playwright/test";
import { escapeRegExp, expandSignals, expect, openSeededCity, seed, test } from "./fixtures";

const [kept, discarded] = seed.signals;

function card(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(escapeRegExp(label)) });
}

async function openCard(page: Page, label: string) {
  await card(page, label).click();
  const controls = page.getByTestId("signal-facet-controls");
  await expect(controls).toHaveCount(1);
  return controls;
}

test("paniers: classify, discard, persist after reload, reveal and restore", async ({ page, network }) => {
  await openSeededCity(page);

  const keptControls = await openCard(page, kept!.label);
  await keptControls.getByRole("button", { name: "Ajouter au panier Pertinent" }).click();
  await expect(keptControls.getByTestId("facet-state-pertinent")).toBeVisible();

  const discardControls = await openCard(page, discarded!.label);
  const reason = discardControls.getByLabel("Code de motif (requis) — Écarter");
  const firstCode = await reason.locator("option:not([value=''])").first().getAttribute("value");
  await reason.selectOption(firstCode!);
  await discardControls.getByTestId("facet-discard-submit").click();
  await expect(page.getByTestId("discarded-notice")).toBeVisible();
  await expect(card(page, discarded!.label)).toHaveCount(0);

  // Both states persist across a full reload (scoped personal routes).
  await page.reload();
  await expandSignals(page);
  await expect(card(page, kept!.label)).toBeVisible();
  await expect(card(page, discarded!.label)).toHaveCount(0);
  const reloaded = await openCard(page, kept!.label);
  await expect(reloaded.getByTestId("facet-state-pertinent")).toBeVisible();

  // The archived target is re-read through reveal and restored with its fingerprint.
  await page.getByLabel("Montrer les écartés").first().check();
  await expect(card(page, discarded!.label)).toBeVisible();
  const archived = await openCard(page, discarded!.label);
  const restored = page.waitForResponse((response) =>
    response.url().includes("/signal-facets/personal/restore") && response.request().method() === "POST");
  await archived.getByTestId("facet-restore").click();
  expect((await restored).status()).toBe(200);
  await page.goto(`/geo/city/${seed.city}?mode=signal&filter.period=all`);
  await expandSignals(page);
  await expect(card(page, discarded!.label)).toBeVisible();

  const scoped = `/api/v1/workspaces/${seed.workspaceId}/signal-facets/`;
  for (const path of ["personal/select", "personal/discard", "reveal", "personal/restore"]) {
    expect(network.some((entry) => entry.url.includes(`${scoped}${path}`) && entry.status === 200), path).toBe(true);
  }
});
