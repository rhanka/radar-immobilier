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

/**
 * Base mint geo dérivée du host au runtime (image CD unique préprod=prod ⇒
 * un défaut build-time ne peut pas différer les deux).
 * - prod `immo.sent-tech.ca` → `https://api.geo.sent-tech.ca`
 * - tout le reste (préprod, dev local) → `https://api.preprod.geo.sent-tech.ca`
 * `VITE_GEO_SAT_MINT_URL` (override) reste prioritaire et renvoyé tel quel.
 */
export function resolveMintUrl(
  hostname: string | null | undefined,
  overrideUrl?: string | null,
): string {
  if (overrideUrl) return overrideUrl;
  // Prod immo.sent-tech.ca → mint prod ; tout le reste (préprod, dev local) → mint préprod.
  const base =
    hostname === "immo.sent-tech.ca"
      ? "https://api.geo.sent-tech.ca"
      : "https://api.preprod.geo.sent-tech.ca";
  return `${base}/basemap/2d/session`;
}
