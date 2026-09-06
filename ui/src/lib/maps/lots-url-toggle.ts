/**
 * Deep-link ZONES-ONLY de la vue Signaux.
 *
 * Sur les grandes villes, le full-fetch séquentiel des LOTS (fetchAllLots) et
 * son fan-out I/O peuvent faire avorter les fetchs → carte vide. Ce toggle
 * d'URL permet d'ouvrir la ville en ZONES-ONLY (sans le fan-out lots), tout en
 * gardant le comportement par défaut (lots activés) quand le paramètre est
 * absent.
 *
 * Valeurs qui DÉSACTIVENT les lots :
 *   - `?lots=0` (aussi `?lots=off`, `?lots=false`, `?lots=no`, insensible à la
 *     casse et aux espaces) ;
 *   - `?layers=zones` (alias zones-only).
 *
 * Toute autre valeur, ou l'absence du paramètre, laisse les lots ACTIVÉS
 * (comportement par défaut STRICTEMENT inchangé). Lu UNE SEULE FOIS au montage
 * (cf. SignauxMapView.onMount) — la couche ZONES reste chargée dans tous les cas.
 */
const LOTS_OFF_VALUES = new Set(["0", "off", "false", "no"]);

/**
 * Retourne `false` (lots désactivés) pour `?lots=0|off|false|no` ou
 * `?layers=zones` ; `true` (défaut inchangé) sinon.
 *
 * @param search — `window.location.search` (ex. `"?lots=0"`) ; chaîne vide
 *   acceptée (aucun paramètre → lots activés).
 */
export function lotsEnabledFromSearch(search: string): boolean {
  const params = new URLSearchParams(search);
  if (params.get("layers")?.trim().toLowerCase() === "zones") return false;
  const raw = params.get("lots");
  if (raw === null) return true;
  return !LOTS_OFF_VALUES.has(raw.trim().toLowerCase());
}
