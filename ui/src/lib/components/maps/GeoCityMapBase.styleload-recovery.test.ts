/**
 * GUARD — FILET DE RÉCUPÉRATION style-load (varennes / onglet caché).
 *
 * Cause racine mesurée en préprod : des couches carto ne se peignent pas / lèvent
 * « Style is not done loading » car des `addSource` s'exécutent avant que le style
 * MapLibre soit prêt OU parce que l'event `'load'` ne survient JAMAIS (onglet caché
 * / canvas taille-nulle au montage) → `mapReady` reste false → la sync réactive
 * early-return → couches jamais peintes, sans filet de récupération.
 *
 * Le socle `GeoCityMapBase` n'est jamais monté en unit test : maplibre-gl exige
 * canvas/WebGL indisponibles en jsdom, donc le composant est TOUJOURS stubé (cf.
 * `GeoCityMapBase.controls-responsive.test.ts`). Ce guard lit donc la SOURCE et
 * prouve, de façon robuste (assertions structurelles, pas de mesure pixel), que le
 * filet de récupération VALIDÉ par geo-socle est bien câblé :
 *   1. écouteurs `visibilitychange` (onglet redevenu visible) ET `ResizeObserver`
 *      (conteneur (re)dimensionné) qui redéclenchent la récupération ;
 *   2. `resize()` puis, si `isStyleLoaded()`, (ré)application des couches par le
 *      MÊME chemin que le handler `'load'` (finalisation exposée via
 *      `triggerFinalize`) ; sinon report via `once('idle')` (retente une fois) ;
 *   3. les `addSource`/`addLayer` de base villes sont protégés par
 *      `getSource`/`getLayer` (idempotence : sûr à rejouer plusieurs fois) ;
 *   4. les écouteurs sont armés au montage et RETIRÉS au démontage (anti-fuite).
 *
 * Pur : aucun Docker, aucune API, aucun composant Svelte monté — lecture fichier.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// Résolu depuis le chemin du module (PAS `new URL(..., import.meta.url)`, que Vite
// réécrit en URL /@fs) — cf. GeoCityMapBase.controls-responsive.test.ts.
const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(HERE, "GeoCityMapBase.svelte"), "utf8");

describe("GeoCityMapBase — filet de récupération style-load (varennes / onglet caché)", () => {
  it("arme un écouteur `visibilitychange` qui ne récupère qu'à l'onglet visible et le RETIRE au démontage", () => {
    // Écoute posée…
    expect(source).toMatch(/addEventListener\(\s*["']visibilitychange["']/);
    // …ne récupère QUE quand l'onglet redevient visible…
    expect(source).toMatch(/visibilityState\s*===\s*["']visible["']/);
    // …en appelant le filet de récupération…
    expect(source).toContain("recoverMapRender");
    // …et est retirée au démontage (anti-fuite).
    expect(source).toMatch(/removeEventListener\(\s*["']visibilitychange["']/);
  });

  it("observe le conteneur via `ResizeObserver` (canvas taille-nulle → réelle) et le déconnecte", () => {
    expect(source).toContain("new ResizeObserver(");
    expect(source).toMatch(/\.observe\(\s*mapContainer\s*\)/);
    // Déconnexion au démontage (anti-fuite).
    expect(source).toMatch(/\.disconnect\(\)/);
  });

  it("le filet appelle `resize()` puis, si `isStyleLoaded()`, REJOUE le chemin `'load'`", () => {
    // resize() force MapLibre à réadapter le framebuffer GL 0×0 et à repeindre.
    expect(source).toMatch(/\.resize\?\.\(\)/);
    // (Ré)application gardée sur l'état réel du style (sinon `addSource` throw).
    expect(source).toContain("isStyleLoaded()");
    // Récupération = le MÊME chemin que le handler `'load'` (finalizeMapSetup),
    // exposé au filet via `triggerFinalize`.
    expect(source).toContain("triggerFinalize");
    expect(source).toMatch(
      /triggerFinalize\s*=\s*\(\)\s*=>\s*void\s+finalizeMapSetup\(\)/,
    );
  });

  it("retente UNE fois via `once('idle')` quand le style n'est pas encore prêt", () => {
    expect(source).toMatch(/once\(\s*["']idle["']/);
    // Garde anti-accumulation d'abonnements idle successifs.
    expect(source).toContain("recoverIdleArmed");
  });

  it("pose les couches de base villes de façon IDEMPOTENTE (getSource/getLayer + liaison unique)", () => {
    expect(source).toContain('if (!m.getSource("cities-polygons"))');
    expect(source).toContain('if (!m.getLayer("cities-fill"))');
    expect(source).toContain('if (!m.getLayer("cities-outline"))');
    expect(source).toContain('if (!m.getLayer("cities-label"))');
    // Les handlers d'interaction villes ne sont liés qu'UNE fois (re-pose sûre).
    expect(source).toContain("citiesInteractionsBound");
  });

  it("arme les écouteurs au montage et les retire au démontage", () => {
    expect(source).toContain("setupRecoveryListeners()");
    expect(source).toContain("teardownRecoveryListeners()");
  });
});
