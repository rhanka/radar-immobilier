import { expect, openSeededCity, seed, test, escapeRegExp } from "./fixtures";

test("signaux: the seeded city renders its signal cards from the scoped reads", async ({ page, network }) => {
  await openSeededCity(page);
  for (const signal of seed.signals) {
    await expect(page.getByRole("button", { name: new RegExp(escapeRegExp(signal.label)) })).toBeVisible();
  }
  const scoped = `/api/v1/workspaces/${seed.workspaceId}/signal-facets/`;
  expect(network.some((entry) => entry.url.includes(`${scoped}coherent-city`) && entry.status === 200)).toBe(true);
  expect(network.some((entry) => entry.url.includes(`${scoped}by-city`) && entry.status === 200)).toBe(true);
});
