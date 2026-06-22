import { expect, test, type Page } from "@playwright/test";
import { mockAuthenticated } from "./_helpers";

/**
 * Le déclencheur du menu « Outils internes » est le bouton de nav « Admin »
 * (aria-haspopup="menu"). On le cible par son nom accessible pour ne PAS
 * collisionner avec le trigger de l'IdentityMenu (« Compte de … »), qui porte
 * aussi aria-haspopup="menu" → sinon strict-mode violation.
 */
function adminTrigger(page: Page) {
  return page.getByRole("button", { name: "Admin", exact: true });
}

/**
 * QA NAVIGATEUR — Décluttrage du menu « Outils internes » + alignement dropdown.
 *
 * Contexte : le menu Admin (outils internes) contenait des entrées « pipeau »
 * (Onboarding, Ciblage, Coordination, Backlog, Carte géo) et son dropdown
 * débordait hors viewport à droite (placement="bottom-start" depuis un trigger
 * en bout de barre).
 *
 * On ASSERTE le RENDU réel (DOM + boundingBox), pas des marqueurs de bundle :
 *   1. Les 5 entrées retirées ont disparu du menu rendu.
 *   2. Les entrées légitimes restent (Admin, Grilles, Console sources, Ontologie).
 *   3. Le dropdown ouvert reste DANS le viewport (pas de débordement à droite).
 */
const REMOVED = ["Onboarding", "Ciblage", "Coordination", "Backlog", "Carte géo"];
const KEPT = ["Admin", "Grilles", "Console sources", "Ontologie"];

test.describe("Menu Outils internes — décluttrage + alignement dropdown", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticated(page, { isAdmin: true });
    await page.goto("/");
    // Le chrome n'apparaît qu'après checkSession() : on attend le header DS.
    await page.locator(".st-appHeader__navLink").first().waitFor({
      state: "visible",
      timeout: 15_000,
    });
  });

  test("le déclencheur Admin est présent pour un admin", async ({ page }) => {
    const trigger = adminTrigger(page);
    await expect(trigger).toBeVisible();
  });

  test("les 5 entrées pipeau ont disparu du menu rendu", async ({ page }) => {
    const trigger = adminTrigger(page);
    await trigger.click();
    // Le menu DS (role=menu, label « Outils internes ») doit être ouvert.
    const menu = page.getByRole("menu", { name: "Outils internes" });
    await expect(menu).toBeVisible();

    for (const label of REMOVED) {
      await expect(
        menu.getByText(label, { exact: true }),
        `« ${label} » doit avoir été retiré du menu`,
      ).toHaveCount(0);
    }
  });

  test("les entrées légitimes restent dans le menu", async ({ page }) => {
    const trigger = adminTrigger(page);
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Outils internes" });
    await expect(menu).toBeVisible();

    for (const label of KEPT) {
      await expect(
        menu.getByText(label, { exact: true }),
        `« ${label} » doit rester dans le menu`,
      ).toHaveCount(1);
    }
  });

  test("le dropdown ouvert ne déborde pas du viewport (aligné dans la fenêtre)", async ({
    page,
  }) => {
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const vw = viewport!.width;
    const vh = viewport!.height;

    const trigger = adminTrigger(page);
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Outils internes" });
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    // Le panneau doit être ENTIÈREMENT contenu dans le viewport : aucun bord
    // hors fenêtre (tolérance 1px pour les arrondis sub-pixel).
    expect(box!.x, "bord gauche dans le viewport").toBeGreaterThanOrEqual(-1);
    expect(box!.y, "bord haut dans le viewport").toBeGreaterThanOrEqual(-1);
    expect(
      box!.x + box!.width,
      "bord droit dans le viewport (pas de débordement à droite)",
    ).toBeLessThanOrEqual(vw + 1);
    expect(
      box!.y + box!.height,
      "bord bas dans le viewport",
    ).toBeLessThanOrEqual(vh + 1);
  });
});
