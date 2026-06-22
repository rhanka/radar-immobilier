import { expect, test, type Page } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * Capture de PREUVE (screenshots) du header AppHeader DS à 1440px :
 *  - header fermé
 *  - menu « Outils internes » (déclencheur « Admin ») OUVERT
 * Le chemin de sortie est piloté par PNG_PREFIX (env), pour distinguer
 * before/after sans dupliquer le spec.
 */
const PREFIX = process.env.PNG_PREFIX ?? "/tmp/header-capture";

function adminTrigger(page: Page) {
  return page.getByRole("button", { name: "Admin", exact: true });
}

test.use({ viewport: { width: 1440, height: 900 } });

test("capture header fermé + dropdown outils ouvert (1440px)", async ({
  page,
}) => {
  await mockAuthenticated(page, { isAdmin: true });
  await page.goto("/");
  await page
    .locator(".st-appHeader__navLink")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });

  // (a) Header fermé — capture du chrome seul (top 96px suffit largement).
  await page.screenshot({
    path: `${PREFIX}-closed.png`,
    clip: { x: 0, y: 0, width: 1440, height: 96 },
  });

  // (b) Dropdown « Outils internes » OUVERT.
  const trigger = adminTrigger(page);
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Outils internes" });
  await expect(menu).toBeVisible();

  // Capture haute (le panneau descend sous le header) — toute la zone utile.
  await page.screenshot({
    path: `${PREFIX}-open.png`,
    clip: { x: 0, y: 0, width: 1440, height: 360 },
  });

  // Trace le boundingBox pour le rapport (alignement vs trigger).
  const menuBox = await menu.boundingBox();
  const trigBox = await trigger.boundingBox();
  // eslint-disable-next-line no-console
  console.log(
    "DIAG menuBox=",
    JSON.stringify(menuBox),
    "triggerBox=",
    JSON.stringify(trigBox),
  );
});
