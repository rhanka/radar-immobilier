/**
 * reference-cities — Catalogue des villes de RÉFÉRENCE (substrat de maquette).
 *
 * Ces 4 villes de la Rive-Sud servent de substrat « mode:simulation » pour
 * valider l'UX carto (couche lots coloriée + compteurs) sur de vraies géométries
 * cadastrales AVANT que le pipeline complet (rôle MAMH + zonage extrait) ne soit
 * disponible. C'est un INPUT/référence, pas un nom d'architecture : la carte ne
 * connaît que des « villes de référence » génériques.
 *
 * Provenance des données : exports GeoJSON publics d'une plateforme de
 * prospection foncière tierce (cadastre + rôle public + zones dessinées, sans
 * PII). En maquette, on les sert en `mode:"simulation"` et `verification:"simulé"`
 * — ces données ne franchissent jamais la frontière du réel (cf. SPEC §6.3).
 */

export interface ReferenceCityRef {
  slug: string;
  name: string;
  region: string;
  /** Nombre de lots à l'échelle réelle (référence) — pour info UI / calibration. */
  fullLotsCount: number;
}

/** Les 4 villes de référence du substrat de maquette (Rive-Sud, CMM). */
export const REFERENCE_CITIES: ReferenceCityRef[] = [
  { slug: "delson", name: "Delson", region: "Montérégie — Rive-Sud", fullLotsCount: 3213 },
  { slug: "sainte-catherine", name: "Sainte-Catherine", region: "Montérégie — Rive-Sud", fullLotsCount: 5615 },
  { slug: "saint-constant", name: "Saint-Constant", region: "Montérégie — Rive-Sud", fullLotsCount: 11261 },
  { slug: "candiac", name: "Candiac", region: "Montérégie — Rive-Sud", fullLotsCount: 7190 },
];

/**
 * Base HTTP publique des JSON de référence (mode:simulation, données de démo).
 *
 * NOTE : c'est un détail de provenance du substrat de maquette, isolé ici ;
 * aucun autre module ne référence cette URL en dur.
 */
export const REFERENCE_DATA_BASE = "https://thriving-kleicha-89b7ef.netlify.app";

export function resolveReferenceCityUrl(slug: string, base = REFERENCE_DATA_BASE): string {
  return `${base.replace(/\/$/, "")}/data/${encodeURIComponent(slug)}.json`;
}

export function findReferenceCity(slug: string): ReferenceCityRef | undefined {
  return REFERENCE_CITIES.find((c) => c.slug === slug);
}
