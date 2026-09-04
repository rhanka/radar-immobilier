/**
 * Harnais QA — expose la logique PURE du clic géographique lot du drill
 * (nav-drill 01KZEG78, spec owner) sur window pour un test dans un VRAI
 * navigateur (chromium). MapLibre/WebGL étant indisponibles en headless (sonde
 * WEBGL=NO, cf. geo-level.harness), on ne peut pas piloter la carte rendue : on
 * valide ici la DÉCISION corrigée du clic lot (vue ville → entre dans la zone ;
 * vue zone → sélectionne le lot ; sans zone → neutre). Le rendu carte réel se
 * valide LIVE côté owner.
 */
import {
  resolveGeoLotClick,
  type GeoLotClickResolution,
} from "../../src/lib/maps/geo-level-navigation.js";

declare global {
  interface Window {
    __resolveGeoLotClick: (input: {
      hasZoneSelection: boolean;
      zoneCode: string | null;
    }) => GeoLotClickResolution;
  }
}

window.__resolveGeoLotClick = (input) => resolveGeoLotClick(input);

const ready = document.getElementById("ready");
if (ready) ready.textContent = "ready";
