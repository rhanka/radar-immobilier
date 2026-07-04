import { expect, test, type Page } from "@playwright/test";

/**
 * QA NAVIGATEUR — consommation des propriétés servies par GEO sur la fiche lot
 * (panneau Signaux) : `superficie_m2` (aire réelle), `frontage_m` (façade
 * canonique), `adresse`, `code_postal`.
 *
 * Le harnais stubbe la collection OGC `qc-lots-ville-qa` avec une réponse
 * BRUTE (snake_case geo) et passe par le VRAI mapping `fetchLots` :
 *   - lot `full`  → la fiche s'allume : superficie réelle « 650 m² », façade
 *     canonique « 22,9 m » SANS mention « estimée », adresse et code postal ;
 *   - lot `empty` → « — » honnête (aucun calcul immo de superficie) ; façade
 *     en repli ESTIMATION immo, étiquetée « ≈ … (estimée) ».
 */

const HARNESS = "/e2e-qa/harness/lot-fiche-geo.html";
const SHOT_DIR = process.env.QA_SHOT_DIR ?? "/tmp";

/** Paires clé → valeur de la grille .entity-meta de la fiche lot focusée. */
async function ficheEntries(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const grid = document.querySelector(".sel-entity-detail .entity-meta");
    if (!grid) return {};
    const out: Record<string, string> = {};
    const children = Array.from(grid.children);
    for (let i = 0; i < children.length; i++) {
      if (!children[i].classList.contains("entity-meta-key")) continue;
      const key = children[i].textContent?.trim() ?? "";
      const value = children[i + 1]?.textContent?.trim() ?? "";
      if (key) out[key] = value;
    }
    return out;
  });
}

test.describe("Fiche lot × propriétés geo (superficie/frontage/adresse/code postal)", () => {
  test("lot avec les 4 champs geo → fiche allumée, façade canonique sans « estimée »", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 460, height: 900 });
    await page.goto(`${HARNESS}?lot=full`);

    // La fiche du lot pré-focusé s'ouvre (accordéon Lots déplié automatiquement).
    await expect(page.locator(".sel-entity-detail")).toBeVisible({ timeout: 10_000 });

    const entries = await ficheEntries(page);
    expect(entries["Lot"]).toBe("1 000 001");
    // Les 4 champs servis par geo, affichés tels quels (copy neutre).
    expect(entries["Adresse"]).toBe("123 rue des Érables");
    expect(entries["Code postal"]).toBe("J5B 1B4");
    expect(entries["Superficie"]).toBe("650 m²");
    expect(entries["Façade"]).toBe("22,9 m");
    // Façade CANONIQUE geo : jamais présentée comme une estimation.
    expect(entries["Façade"]).not.toContain("estimée");
    expect(entries["Façade"]).not.toContain("≈");

    await page.screenshot({ path: `${SHOT_DIR}/lot-fiche-geo-full.png`, fullPage: true });
  });

  test("lot sans champs geo → « — » honnête, façade en repli estimation immo", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 460, height: 900 });
    await page.goto(`${HARNESS}?lot=empty`);

    await expect(page.locator(".sel-entity-detail")).toBeVisible({ timeout: 10_000 });

    const entries = await ficheEntries(page);
    expect(entries["Lot"]).toBe("1 000 002");
    // Aucun champ servi → « — », AUCUNE invention (pas de calcul immo).
    expect(entries["Adresse"]).toBe("—");
    expect(entries["Code postal"]).toBe("—");
    expect(entries["Superficie"]).toBe("—");
    // Façade : repli estimation géométrique immo, étiquetée honnêtement.
    expect(entries["Façade"]).toMatch(/^≈ /u);
    expect(entries["Façade"]).toContain("(estimée)");
    expect(entries["Façade"]).toContain("20");

    await page.screenshot({ path: `${SHOT_DIR}/lot-fiche-geo-empty.png`, fullPage: true });
  });
});
