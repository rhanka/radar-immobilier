import type { Page } from "@playwright/test";
import { escapeRegExp, expect, openSeededCity, seed, test } from "./fixtures";

function card(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(escapeRegExp(label)) });
}

async function openCard(page: Page, label: string) {
  await card(page, label).click();
  await expect(page.locator("[data-signal-node]").first()).toBeVisible();
}

test("signal card: classement control present, no legacy triage or notes control", async ({ page, network }) => {
  await openSeededCity(page);

  for (const signal of seed.signals) {
    await openCard(page, signal.label);
  }

  // Classement (spec 2026-11-08): each card header carries the classement icon.
  await expect(page.getByTestId("signal-classement-button").first()).toBeVisible();

  // No legacy triage control anywhere in the unfolded card.
  await expect(page.getByTestId("signal-facet-controls")).toHaveCount(0);
  await expect(page.getByTestId("show-discarded-row")).toHaveCount(0);
  await expect(page.getByTestId("facet-badge-pertinent")).toHaveCount(0);
  await expect(page.getByTestId("facet-badge-watching")).toHaveCount(0);
  await expect(page.getByTestId("facet-badge-archived")).toHaveCount(0);
  await expect(page.getByTestId("discarded-notice")).toHaveCount(0);
  await expect(page.getByLabel("Montrer les écartés")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ajouter au panier Pertinent" })).toHaveCount(0);

  // No notes control anywhere in the unfolded card.
  await expect(page.getByTestId("entity-annotations")).toHaveCount(0);
  await expect(page.getByTestId("annotation-add")).toHaveCount(0);
  await expect(page.getByPlaceholder("Ajouter une note…")).toHaveCount(0);
  await expect(page.getByTestId("fiche-annotations")).toHaveCount(0);

  // The read-only card content is still there.
  await expect(page.getByText("Preuve").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Voir la preuve/ }).first()).toBeVisible();

  // No classement WRITE on load: writes happen only on an explicit menu
  // choice. Reason-code and coherent reads are the existing basket API reads.
  const facetWrites = network.filter((entry) =>
    entry.method !== "GET" &&
    /\/signal-facets\/personal\//.test(new URL(entry.url).pathname),
  );
  expect(facetWrites, "classement write traffic observed on load").toEqual([]);

  // No prospect notes traffic: the lot notes machinery is removed, marks stay.
  const notesReads = network.filter((entry) =>
    /\/prospects\/.*notes/.test(new URL(entry.url).pathname),
  );
  expect(notesReads, "prospect notes API traffic observed").toEqual([]);
});
