/**
 * Harnais QA — expose la logique pure de transition de niveau géo (bug #4) sur
 * window pour un test exécuté dans un VRAI navigateur (chromium), pas en jsdom.
 * MapLibre/WebGL étant indisponibles en headless, on valide ici la DÉCISION de
 * navigation (la partie corrigée du dézoom), pas le rendu WebGL.
 */
import {
  buildGeoLevelNavigation,
  type GeoLevelNavInput,
} from "../../src/lib/maps/geo-level-navigation.js";

declare global {
  interface Window {
    __buildGeoLevelNavigation: (input: GeoLevelNavInput) => unknown;
  }
}

window.__buildGeoLevelNavigation = (input) => buildGeoLevelNavigation(input);

const ready = document.getElementById("ready");
if (ready) ready.textContent = "ready";
