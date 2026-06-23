import { expect, test } from "@playwright/test";

/**
 * QA NAVIGATEUR — LOT 2 (#84), volet PANNEAU DE DROITE.
 *
 * Le panneau de droite (SignauxSelPanel) doit afficher, dans la fiche d'un
 * signal focusé : son ID, une PASTILLE COULEUR (même code couleur que le signal
 * COURANT dans le viewer de preuve), et un badge « +N sur ce PV » quand
 * plusieurs signaux pointent le même procès-verbal. Cela fait le lien visuel
 * surlignage ↔ fiche demandé par l'option 1.
 *
 * Le harnais monte le panneau avec DEUX signaux partageant le même rawRef et
 * pré-focus le 1er.
 */

const HARNESS = "/e2e-qa/harness/sel-panel.html";
const SHOT_DIR = "/tmp";

test.describe("SignauxSelPanel — ID signal + pastille couleur (LOT 2 #84)", () => {
  test("la fiche affiche l'ID, la pastille couleur et le badge co-PV", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 460, height: 800 });
    await page.goto(HARNESS);

    // Déplie la section « Signaux » (<details>/<summary>), puis ouvre la fiche
    // du 1er signal — exactement le parcours utilisateur.
    await page.locator("summary", { hasText: "Signaux" }).click();
    await page.locator(".sel-entity-label", { hasText: "A16" }).first().click();

    // La fiche du 1er signal est ouverte.
    await expect(page.locator(".signal-id-row")).toBeVisible({ timeout: 10_000 });

    // ID technique du signal affiché.
    await expect(page.locator(".signal-id-val")).toHaveText("sig-A16");

    // Pastille couleur présente avec un background non vide (couleur du rang 0).
    const dotBg = await page.locator(".signal-color-dot").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(dotBg).not.toBe("");
    expect(dotBg).not.toBe("rgba(0, 0, 0, 0)");

    // Badge co-PV : 2 signaux sur le même rawRef → « +1 sur ce PV ».
    await expect(page.locator(".signal-copv-badge")).toContainText("+1 sur ce PV");

    await page.screenshot({ path: `${SHOT_DIR}/pdf-v2-84-pane-signal-id.png` });
  });
});
