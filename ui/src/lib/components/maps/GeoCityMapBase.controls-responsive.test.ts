/**
 * GUARD — contrôles bas de carte RESPONSIVE (mobile-first).
 *
 * Le socle `GeoCityMapBase` n'est jamais rendu en unit test : maplibre-gl exige
 * canvas/WebGL indisponibles en jsdom, donc le composant est TOUJOURS stubé (cf.
 * `SourceCoverageMap.test.ts` → `GeoCityMapBaseStub.svelte`) ; son rendu réel est
 * couvert par l'e2e. Ce guard lit donc la SOURCE et prouve la règle mobile-first
 * des DEUX conteneurs de contrôle bas :
 *   - `bottom-20`     → mobile (au-dessus de la bulle de chat bas-droit) ;
 *   - `md:bottom-3`   → desktop (pas de vide bas).
 * Si l'une des deux classes régresse sur l'un des conteneurs, ce test rougit.
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
 * ancrage latéral + sa signature flex (mesure = droite/flex-col-reverse,
 * légende = gauche/items-start).
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

describe("GeoCityMapBase — contrôles bas responsive (mobile-first)", () => {
  it("le conteneur MESURE (droite) porte bottom-20 ET md:bottom-3", () => {
    const div = controlContainer("right-3", "flex-col-reverse");
    expect(div).toContain("bottom-20"); // mobile préservé
    expect(div).toContain("md:bottom-3"); // desktop sans vide bas
  });

  it("le conteneur LÉGENDE (gauche) porte bottom-20 ET md:bottom-3", () => {
    const div = controlContainer("left-3", "items-start");
    expect(div).toContain("bottom-20");
    expect(div).toContain("md:bottom-3");
  });
});
