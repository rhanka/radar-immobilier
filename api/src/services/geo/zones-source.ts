/**
 * Flag d'aiguillage de la SOURCE de géométrie du ZONAGE (zero-copy géo, #73 lot 1).
 *
 * `GEO_ZONES_SOURCE` décide d'où vient la FORME des zones d'urbanisme rendues
 * sur la carte :
 *
 *  - `live` (DÉFAUT) — le rendu vient du LIVE GEO (proxy OGC passthrough,
 *    `qc-zonage-<city>` servi par api.geo.sent-tech.ca). Le store-local Postgres
 *    (`zone_versions`) n'est plus qu'un FALLBACK quand le live geo 404/échoue.
 *    C'est le correctif de fraîcheur : on cesse de rendre une géométrie de
 *    zonage périmée du PG (ex. Sutton `P-1/939 arcgis`) quand le live geo sert
 *    déjà la cohorte à jour (95 zones `RUR-*, CONS-*, H-* geopdf-esri`).
 *
 *  - `pg` — restaure l'ancien comportement : le store-local PG est la source
 *    primaire de la géométrie zonage (rollback instantané).
 *
 * N'affecte QUE le zonage. Les LOTS restent store-local-first (blast radius
 * borné). N'affecte pas le mapper (`resolve-refs.ts`, index PG — lot 3).
 */

export type ZonesSource = "live" | "pg";

/**
 * Résout la source de géométrie zonage effective.
 *
 * @param override  Valeur injectée (tests / deps de route). Prioritaire.
 * @returns `pg` uniquement si explicitement demandé ; `live` sinon (défaut).
 */
export function resolveZonesSource(override?: ZonesSource): ZonesSource {
  if (override) return override;
  return process.env["GEO_ZONES_SOURCE"] === "pg" ? "pg" : "live";
}
