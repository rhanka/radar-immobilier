import { expect, seed, test } from "./fixtures";

test("metadata: period relevance filters exclusions and city keep exact counts and URLs", async ({ page, network }) => {
  await page.goto("/geo/region/quebec?mode=signal&filter.period=all&filter.zonage=1&filter.residentiel=1&filter.precoce=1&filter.excludePiia=1&filter.excludeDerogations=1");
  const total = page.getByText("3 signaux · 1 ville", { exact: false });
  await expect(total).toBeVisible();
  expect(network.filter((r) => r.url.includes("coherent-city"))).toHaveLength(0);
  const metadata = network.filter((r) => r.url.includes("by-city"));
  expect(metadata.length).toBeGreaterThan(0);
  expect(metadata.every((r) => new URL(r.url).searchParams.get("contract") === "metadata-v2")).toBe(true);

  const period = page.getByRole("button", { name: /^Période des signaux/ });
  await period.click();
  await page.getByRole("option", { name: "Dernière semaine", exact: true }).click();
  await expect(page).toHaveURL(/filter.period=7d/);
  // Seeded unknown dates are excluded from bounded periods.
  await expect(page.getByText(/0 signaux.*0 ville/).first()).toBeVisible();
  await period.click();
  await page.getByRole("option", { name: "Illimité", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("filter.period")).toBeNull();
  await expect(total).toBeVisible();

  await page.getByTestId("classement-filter-trigger").click();
  const relevance = page.getByTestId("classement-filter-panel");
  const unclassified = relevance.getByRole("checkbox", { name: "Non classé", exact: true });
  await unclassified.click();
  await expect(page).toHaveURL(/filter.classement=/);
  // Relevance counters ignore the selected class set.
  await expect(relevance.locator(".classement-row").filter({ has: unclassified }).getByLabel("3 signaux")).toBeVisible();
  await expect(page.getByText(/0 signaux.*0 ville/).first()).toBeVisible();
  await unclassified.click();
  await expect(total).toBeVisible();

  await page.getByTestId("filtre-trigger").click();
  const filters = page.getByTestId("filtre-panel");
  for (const label of ["Zonage", "Résidentiel", "Précoce", "Exclure PIIA sans projet résidentiel", "Exclure dérogations mineures"]) {
    const checkbox = filters.getByRole("checkbox", { name: label, exact: true });
    await checkbox.click();
    await expect(total).toBeVisible();
    await checkbox.click();
    await expect(total).toBeVisible();
  }
  await page.getByTestId("filtre-trigger").click();
  const urlBeforeCity = new URL(page.url());
  const countsBeforeCity = await total.textContent();
  await page.getByRole("button", { name: /Salaberry-de-Valleyfield/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/geo/city/${seed.city}`));
  await expect(total).toHaveText(countsBeforeCity!);
  const urlAfterCity = new URL(page.url());
  expect(urlAfterCity.searchParams.get("filter.period")).toBe(urlBeforeCity.searchParams.get("filter.period"));
  expect(network.some((r) => r.url.includes("coherent-city") && r.status === 200)).toBe(true);
});
