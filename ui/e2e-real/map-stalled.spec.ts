import { expect, openSeededCity, seed, test, escapeRegExp } from "./fixtures";

/**
 * Preprod 2026-10-31 08:43–08:55 UTC: in a Chrome tab that renders no frame
 * (window not composited, tab driven over CDP without focus), MapLibre never
 * parses its inline style (it waits on requestAnimationFrame). The 6 s
 * fallback then forced the map "ready" on an unloaded style, every
 * `addSource` threw "Style is not done loading" inside the Signaux reactive
 * flush, and the view froze on "Chargement de la carte…" / "Chargement des
 * zones…" / "Chargement des lots…" although every API read answered 200.
 *
 * The tab without frames is reproduced by holding requestAnimationFrame
 * callbacks until the test releases them.
 */
test("signaux: a tab that renders no frame shows an explicit map message, never an endless loading", async ({ page, network }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const held: FrameRequestCallback[] = [];
    const native = window.requestAnimationFrame.bind(window);
    (window as unknown as { __resumeFrames: () => void }).__resumeFrames = () => {
      window.requestAnimationFrame = native;
      for (const callback of held.splice(0)) native(callback);
    };
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      held.push(callback);
      return held.length;
    };
  });

  // Scoped reads and signal cards still load while the map cannot render.
  await openSeededCity(page);
  const stalled = page.getByTestId("map-stalled");
  await expect(stalled).toBeVisible();
  await expect(stalled).toContainText("La carte ne s'affiche pas");
  await expect(stalled.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await expect(page.getByText("Chargement de la carte…")).toHaveCount(0);
  await expect(page.getByText("Chargement des zones…")).toHaveCount(0);
  await expect(page.getByText("Chargement des lots…")).toHaveCount(0);
  for (const signal of seed.signals) {
    await expect(page.getByRole("button", { name: new RegExp(escapeRegExp(signal.label)) })).toBeVisible();
  }
  const scoped = `/api/v1/workspaces/${seed.workspaceId}/signal-facets/`;
  expect(network.some((entry) => entry.url.includes(`${scoped}coherent-city`) && entry.status === 200)).toBe(true);

  // Frames resume (tab back in the foreground): the map finishes on its own.
  await page.evaluate(() => (window as unknown as { __resumeFrames: () => void }).__resumeFrames());
  await expect(stalled).toHaveCount(0);
  await expect(page.getByText("Chargement de la carte…")).toHaveCount(0);
  expect(pageErrors.filter((message) => message.includes("Style is not done loading"))).toEqual([]);
});
