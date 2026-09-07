/**
 * GUARD — contrôles bas de carte (§5.1) : ANCRAGE PARTAGÉ, mesure à GAUCHE,
 * légende ALIGNÉE, bande d'attribution.
 *
 * Le socle `GeoCityMapBase` n'est jamais rendu en unit test : maplibre-gl exige
 * canvas/WebGL indisponibles en jsdom, donc le composant est TOUJOURS stubé (cf.
 * `SourceCoverageMap.test.ts`) ; son rendu réel est couvert par l'e2e. Ce guard
 * lit donc la SOURCE et prouve la structure DOM cible du §5.1 R2 :
 *   - les DEUX conteneurs bas partagent l'ancrage `bottom-20` (mobile, au-dessus
 *     de la bulle de chat) ET `md:bottom-10` (desktop, 2,5 rem au-dessus de
 *     l'attribution — remplace l'ancien `md:bottom-3`) ;
 *   - les deux passent en `flex-col-reverse` (panneaux ouverts vers le HAUT,
 *     boutons alignés sur la même ligne basse) ;
 *   - la RANGÉE `map-control-row` porte UN seul gap (token `--st-spacing`), aucun
 *     gap imbriqué (le sous-groupe à gap propre `basemap-group` a disparu) → les
 *     intervalles entre boîtes sont ÉGAUX par construction (la mesure pixel exacte
 *     est faite en recette navigateur) ;
 *   - ordre des enfants directs : Mesure → Fond de carte (Layers) → slot terminal
 *     `controls-bottom-right-end` (échafaudage, garantit « tout à droite ») ;
 *   - le contrôle de fond est UN seul trigger DS `Layers` (menu vers le haut,
 *     `top-end`) à deux options radio, plus les deux boutons #646 (§4 R2) ;
 *   - le glyph de légende est lucide `Map` (`MapIcon`), plus `ListTree` (§6 R2) ;
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

describe("GeoCityMapBase — contrôles bas (§5.1 R2) rangée uniforme + menu Layers + icône Map", () => {
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

  it("la rangée map-control-row a UN seul gap token --st-spacing (aucun gap imbriqué)", () => {
    expect(source).toContain('class="map-control-row"');
    // Le gap de la rangée est un TOKEN spacing DS unique (pas une palette locale).
    expect(source).toMatch(/\.map-control-row\s*\{[^}]*gap:\s*var\(--st-spacing-\d+/);
    // L'ancien sous-groupe à gap propre a disparu → aucun gap imbriqué dans la rangée.
    expect(source).not.toContain("basemap-group");
  });

  it("ordre des enfants directs : Mesure → Fond de carte (Layers) → slot terminal", () => {
    const measureIdx = source.indexOf('data-testid="measure-toggle"');
    const basemapIdx = source.indexOf('data-testid="basemap-control"');
    const slotIdx = source.indexOf('name="controls-bottom-right-end"');
    expect(measureIdx).toBeGreaterThan(-1);
    expect(basemapIdx).toBeGreaterThan(-1);
    expect(slotIdx).toBeGreaterThan(-1);
    // Mesure AVANT le contrôle de fond AVANT le slot terminal (chat = tout à droite).
    expect(measureIdx).toBeLessThan(basemapIdx);
    expect(basemapIdx).toBeLessThan(slotIdx);
  });

  it("le contrôle de fond est UN seul trigger DS (Layers) ouvrant un menu vers le HAUT (top-end)", () => {
    expect(source).toContain("MenuTriggerButton");
    expect(source).toContain("MenuPopover");
    expect(source).toContain('name="layers"');
    expect(source).toContain('placement="top-end"');
    // Deux options radio Plan/Satellite (pas deux boutons pressés).
    expect(source).toContain('role="menuitemradio"');
    // Les deux boutons #646 ont disparu.
    expect(source).not.toContain('data-testid="basemap-btn-plan"');
    expect(source).not.toContain('data-testid="basemap-btn-satellite"');
  });

  it("le glyph de légende est lucide Map (MapIcon), plus ListTree (§6 R2)", () => {
    expect(source).toContain("<MapIcon");
    expect(source).not.toContain("<ListTree");
    // L'alias `Map as MapIcon` évite de masquer le constructeur JS `Map`.
    expect(source).toContain("Map as MapIcon");
    // `SatelliteIcon` retiré avec les deux boutons #646.
    expect(source).not.toContain("Satellite as SatelliteIcon");
  });

  it("l'attribution satellite est ancrée « bottom-right » (bande réservée §5.3)", () => {
    expect(source).toContain('"bottom-right"');
  });
});
