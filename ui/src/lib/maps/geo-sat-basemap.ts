/**
 * §5 — activation RUNTIME du fond satellite 2D (Google Map Tiles).
 *
 * Le pipeline CD construit UNE seule image `radar-ui:<sha>` (déployée telle
 * quelle en préprod ET en prod), donc un flag `VITE_` build-time ne peut pas
 * différer préprod/prod. On résout donc à l'exécution par **allowlist de
 * hosts** : ON uniquement sur les hosts listés (préprod + dev local), OFF
 * partout ailleurs — dont la prod `immo.sent-tech.ca`.
 *
 * `VITE_GEO_SAT_BASEMAP === "false"` reste un **kill-switch build** : il force
 * OFF même sur un host allowlisté (désactivation d'urgence via un simple
 * rebuild, sans toucher la config host). Durable (hors cette PR) : un
 * `/config.js` injecté par nginx/env (i-infra) remplacera l'allowlist.
 */

/** Hosts où le satellite est actif (préprod + dev local). Prod ABSENTE → OFF. */
export const SAT_HOST_ALLOWLIST: ReadonlySet<string> = new Set([
  "preprod.immo.sent-tech.ca",
  "localhost",
  "127.0.0.1",
]);

/**
 * Le fond satellite est-il actif pour ce host ? `killSwitchOff` (=
 * `VITE_GEO_SAT_BASEMAP === "false"`) force OFF quel que soit le host.
 * `hostname` absent (SSR/tests sans DOM) ⇒ OFF (fail-safe).
 */
export function isSatelliteBasemapEnabled(
  hostname: string | null | undefined,
  killSwitchOff: boolean,
): boolean {
  if (killSwitchOff) return false;
  if (!hostname) return false;
  return SAT_HOST_ALLOWLIST.has(hostname);
}
