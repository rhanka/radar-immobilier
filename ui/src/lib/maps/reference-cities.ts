/**
 * reference-cities — Catalogue des villes de la CARTE STEVE.
 *
 * Ces 4 villes de la Rive-Sud (Delson, Sainte-Catherine, Saint-Constant, Candiac)
 * sont issues de la plateforme Netlify de Steve (prospection foncière tierce).
 * Ce sont des DONNÉES RÉELLES (cadastre + rôle public + zones dessinées, sans PII),
 * pas des données simulées ou inventées.
 *
 * Elles servent de référence pour la carte cadastrale (UX carto — couche lots
 * coloriée) en attendant que le pipeline complet (rôle MAMH + zonage extrait)
 * couvre ces villes. Mode interne : "carte-steve" (cf. SPEC §6.3).
 */

export interface ReferenceCityRef {
  slug: string;
  name: string;
  region: string;
  /** Nombre de lots à l'échelle réelle (référence) — pour info UI / calibration. */
  fullLotsCount: number;
}

/** Les 4 villes de la carte Steve (Rive-Sud, CMM). Données réelles Netlify. */
export const REFERENCE_CITIES: ReferenceCityRef[] = [
  { slug: "delson", name: "Delson", region: "Montérégie — Rive-Sud", fullLotsCount: 3213 },
  { slug: "sainte-catherine", name: "Sainte-Catherine", region: "Montérégie — Rive-Sud", fullLotsCount: 5615 },
  { slug: "saint-constant", name: "Saint-Constant", region: "Montérégie — Rive-Sud", fullLotsCount: 11261 },
  { slug: "candiac", name: "Candiac", region: "Montérégie — Rive-Sud", fullLotsCount: 7190 },
];

/**
 * Base HTTP publique des JSON de la carte Steve (données réelles Netlify).
 *
 * NOTE : c'est un détail de provenance du substrat carte-steve, isolé ici ;
 * aucun autre module ne référence cette URL en dur.
 */
export const REFERENCE_DATA_BASE = "https://thriving-kleicha-89b7ef.netlify.app";

export function resolveReferenceCityUrl(slug: string, base = REFERENCE_DATA_BASE): string {
  return `${base.replace(/\/$/, "")}/data/${encodeURIComponent(slug)}.json`;
}

export function findReferenceCity(slug: string): ReferenceCityRef | undefined {
  return REFERENCE_CITIES.find((c) => c.slug === slug);
}
