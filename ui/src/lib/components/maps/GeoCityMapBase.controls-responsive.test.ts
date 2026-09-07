/**
 * GUARD — contrôles bas de carte (§5.1) : ANCRAGE PARTAGÉ, mesure à GAUCHE,
 * légende ALIGNÉE, bande d'attribution.
 *
 * Le socle `GeoCityMapBase` n'est jamais rendu en unit test : maplibre-gl exige
 * canvas/WebGL indisponibles en jsdom, donc le composant est TOUJOURS stubé (cf.
 * `SourceCoverageMap.test.ts`) ; son rendu réel est couvert par l'e2e. Ce guard
 * lit donc la SOURCE et prouve la structure DOM cible du §5.1 :
 *   - les DEUX conteneurs bas partagent l'ancrage `bottom-20` (mobile, au-dessus
 *     de la bulle de chat) ET `md:bottom-10` (desktop, 2,5 rem au-dessus de
 *     l'attribution — remplace l'ancien `md:bottom-3`) ;
 *   - les deux passent en `flex-col-reverse` (panneaux ouverts vers le HAUT,
 *     boutons alignés sur la même ligne basse) ;
 *   - dans la rangée bas-droit, le bouton MESURE précède le groupe Fond de carte
 *     (la mesure est « décalée à gauche ») ;
 *   - le glyph de légende est `ListTree` (§2 point 4) ;
 *   - l'attribution satellite est ajoutée en `"bottom-right"` (§5.3 point 1).
 *
 * Pur : aucun Docker, aucune API, aucun composant Svelte monté — lecture fichier.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// Résolu depuis le chemin du module (PAS `new URL(..., import.meta.url)`, que
// Vite réécrit en URL /@fs) — cf. legacy-filter-a-transport.test.ts.
const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(HERE, "GeoCityMapBase.svelte"), "utf8");

/**
 * Ligne du <div> conteneur d'un contrôle bas, identifiée sans ambiguïté par son
 * ancrage latéral + sa signature flex (mesure = droite/items-end,
 * légende = gauche/items-start — les deux en flex-col-reverse).
 */
function controlContainer(sideAnchor: string, flexAnchor: string): string {
  const line = source
    .split("\n")
    .find(
      (l) =>
        l.includes("<div") &&
        l.includes("absolute") &&
        l.includes("z-10") &&
        l.includes(sideAnchor) &&
        l.includes(flexAnchor),
    );
  expect(
    line,
    `conteneur de contrôle absolu introuvable (${sideAnchor} / ${flexAnchor})`,
  ).toBeTruthy();
  return line!;
}

describe("GeoCityMapBase — contrôles bas (§5.1) ancrage partagé + mesure à gauche", () => {
  it("le conteneur MESURE (droite) porte bottom-20 ET md:bottom-10, flex-col-reverse", () => {
    const div = controlContainer("right-3", "items-end");
    expect(div).toContain("bottom-20"); // mobile préservé
    expect(div).toContain("md:bottom-10"); // desktop : au-dessus de l'attribution
    expect(div).not.toContain("md:bottom-3"); // l'ancien ancrage a disparu
    expect(div).toContain("flex-col-reverse"); // panneaux ouverts vers le haut
  });

  it("le conteneur LÉGENDE (gauche) porte bottom-20 ET md:bottom-10, flex-col-reverse", () => {
    const div = controlContainer("left-3", "items-start");
    expect(div).toContain("bottom-20");
    expect(div).toContain("md:bottom-10");
    expect(div).not.toContain("md:bottom-3");
    expect(div).toContain("flex-col-reverse"); // bouton en bas, panneau au-dessus
  });

  it("MESURE est à GAUCHE du groupe Fond de carte (ordre DOM de la rangée)", () => {
    const measureIdx = source.indexOf('data-testid="measure-toggle"');
    const basemapIdx = source.indexOf('data-testid="basemap-control"');
    expect(measureIdx).toBeGreaterThan(-1);
    expect(basemapIdx).toBeGreaterThan(-1);
    // Le bouton mesure est déclaré AVANT le groupe Plan/Satellite → rendu à gauche.
    expect(measureIdx).toBeLessThan(basemapIdx);
  });

  it("le groupe Fond de carte est un role=group « Fond de carte » avec 2 boutons a11y", () => {
    expect(source).toContain('role="group"');
    expect(source).toContain('aria-label="Fond de carte"');
    expect(source).toContain('aria-label="Afficher le plan"');
    expect(source).toContain('aria-label="Afficher le satellite"');
  });

  it("le glyph de légende est ListTree (§2 point 4)", () => {
    expect(source).toContain("ListTree");
    expect(source).toContain("<ListTree");
    // L'alias `Map as MapIcon` évite de masquer le constructeur JS `Map`.
    expect(source).toContain("Map as MapIcon");
    expect(source).toContain("Satellite as SatelliteIcon");
  });

  it("l'attribution satellite est ancrée « bottom-right » (bande réservée §5.3)", () => {
    expect(source).toContain('"bottom-right"');
  });
});
