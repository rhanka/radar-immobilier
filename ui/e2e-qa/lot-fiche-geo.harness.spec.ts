import { expect, test, type Page } from "@playwright/test";

/**
 * QA NAVIGATEUR — consommation des propriétés servies par GEO sur la fiche lot
 * (panneau Signaux) : `surface_m2` (aire réelle du polygone — l'ancien nom
 * `superficie_m2` n'a JAMAIS été servi, bug #350), `frontage_m` (façade
 * canonique), `adresse`, `code_postal` (FSA 3 caractères), normes foldées
 * par lot (`<norme>_value`/`_unit`) et `in_tod`.
 *
 * Le harnais stubbe la collection OGC `qc-lots-ville-qa` avec une réponse
 * BRUTE (snake_case geo) et passe par le VRAI mapping `fetchLots` :
 *   - lot `full`  → la fiche s'allume : superficie réelle « 650 m² », façade
 *     canonique « 22,9 m » SANS mention « estimée », adresse, code postal FSA
 *     « J3Y (secteur) », normes verbatim (valeur + unité), TOD « Oui » ;
 *   - lot `empty` → « — » honnête partout (aucun calcul immo, aucune norme
 *     inventée) ; façade en repli ESTIMATION immo, étiquetée « ≈ … (estimée) ».
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

test.describe("Fiche lot × propriétés geo (surface_m2/frontage/adresse/code postal/normes)", () => {
  test("lot avec champs geo → fiche allumée : surface_m2, FSA, normes verbatim", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 460, height: 1100 });
    await page.goto(`${HARNESS}?lot=full`);

    // La fiche du lot pré-focusé s'ouvre (accordéon Lots déplié automatiquement).
    await expect(page.locator(".sel-entity-detail")).toBeVisible({ timeout: 10_000 });

    const entries = await ficheEntries(page);
    expect(entries["Lot"]).toBe("1 000 001");
    // Champs servis par geo, affichés tels quels (copy neutre).
    expect(entries["Adresse"]).toBe("123 rue des Érables");
    // FSA 3 caractères → affiché tel quel + libellé discret « (secteur) ».
    expect(entries["Code postal"]).toBe("J3Y (secteur)");
    // `surface_m2` (aire réelle) → Superficie arrondie, format fr-CA.
    expect(entries["Superficie"]).toBe("650 m²");
    expect(entries["Façade"]).toBe("22,9 m");
    // Façade CANONIQUE geo : jamais présentée comme une estimation.
    expect(entries["Façade"]).not.toContain("estimée");
    expect(entries["Façade"]).not.toContain("≈");
    // `in_tod` geo foldé sur le badge TOD.
    expect(entries["Périmètre TOD"]).toBe("Oui");
    // Normes foldées par lot : valeur + unité VERBATIM quand servies —
    // « Façade min »/« Superficie min » = NORMES, distinctes de la façade
    // réelle (22,9 m) et de l'aire réelle (650 m²).
    expect(entries["Hauteur max"]).toBe("12.5 m");
    expect(entries["Densité"]).toBe("35 log/ha");
    expect(entries["Façade min"]).toBe("15");
    expect(entries["Superficie min"]).toBe("460 m²");
    expect(entries["Marge avant"]).toBe("6");
    expect(entries["Marge latérale"]).toBe("2");
    expect(entries["Marge arrière"]).toBe("7.5");

    await page.screenshot({ path: `${SHOT_DIR}/lot-fiche-geo-full.png`, fullPage: true });
  });

  test("lot sans champs geo → « — » honnête, façade en repli estimation immo", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 460, height: 1100 });
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
    // Aucune norme servie → chaque ligne « Normes de zonage » à « — ».
    for (const label of [
      "Hauteur max",
      "Densité",
      "Façade min",
      "Superficie min",
      "Marge avant",
      "Marge latérale",
      "Marge arrière",
    ]) {
      expect(entries[label]).toBe("—");
    }

    await page.screenshot({ path: `${SHOT_DIR}/lot-fiche-geo-empty.png`, fullPage: true });
  });
});
