/**
 * zone-source — typage de la SOURCE d'une zone pour la fiche zone (m8).
 *
 * La fiche montrait seulement « Source : officiel » / « Géométrie : géométrie
 * officielle » — trop pauvre pour ouvrir la source. On dérive ici un TYPE de
 * source lisible + une action d'ouverture depuis les métadonnées RÉELLEMENT
 * servies à l'UI (`source` / `geometryStatus` / `confidence` / `grillePdfUrl`).
 *
 * LIMITE DE CONTRAT (ask geo) : la provenance FINE demandée — « recalage » vs
 * « geojson dans PDF » vs « site » — n'est PAS discriminée par les métadonnées
 * servies : une géométrie `official` arrive de la collection OGC sans dire si
 * elle vient d'un site SIG, d'un geojson extrait de PDF ou d'un recalage. Le
 * type est alors une APPROXIMATION (`approximate: true`). De même, aucune URL
 * de SITE ni de SCREENSHOT n'est servie par zone : la seule source ouvrable
 * aujourd'hui est la grille de zonage PDF (`grillePdfUrl`). L'iframe « site » et
 * le fallback screenshot sont donc câblés côté UI mais restent inertes tant que
 * geo n'expose pas ces URLs.
 */
import type { GeoZoneProperties } from "$lib/maps/geo-zones-client.js";

export type ZoneSourceType =
  | "site"
  | "geojson-pdf"
  | "recalage"
  | "texte"
  | "designee"
  | "missing";

export type ZoneSourceOpenKind = "pdf" | "iframe" | null;

export interface ZoneSourceDescriptor {
  /** Type de source dérivé (taxonomie recalage / geojson-pdf / site + états). */
  type: ZoneSourceType;
  /** Libellé client neutre du type de source. */
  label: string;
  /** URL ouvrable servie (grille PDF aujourd'hui) ; null si aucune. */
  openUrl: string | null;
  /** Mode d'ouverture : viewer PDF, iframe site, ou rien à ouvrir. */
  openKind: ZoneSourceOpenKind;
  /**
   * true quand la provenance fine (site / geojson-dans-PDF / recalage) n'est PAS
   * distinguée par le contrat servi : le type est une approximation à confirmer
   * côté geo (pas une affirmation forte).
   */
  approximate: boolean;
}

const TYPE_LABELS: Record<ZoneSourceType, string> = {
  site: "Site officiel (SIG)",
  "geojson-pdf": "GeoJSON dans PDF",
  recalage: "Recalage",
  texte: "Référence texte (sans géométrie)",
  designee: "Désignée par un signal",
  missing: "Source non disponible",
};

/**
 * Décrit la source d'une zone à partir des métadonnées servies. La grille PDF,
 * quand elle est présente, est l'unique source OUVRABLE aujourd'hui (viewer
 * PDF) — indépendamment du type de géométrie.
 */
export function describeZoneSource(
  props: GeoZoneProperties,
): ZoneSourceDescriptor {
  const grille = props.grillePdfUrl ?? null;
  const openUrl = grille;
  const openKind: ZoneSourceOpenKind = grille ? "pdf" : null;

  const make = (
    type: ZoneSourceType,
    approximate: boolean,
  ): ZoneSourceDescriptor => ({
    type,
    label: TYPE_LABELS[type],
    openUrl,
    openKind,
    approximate,
  });

  // Zone désignée par un signal : provenance réglementaire, pas géométrique.
  if (props.source === "signal-designated") return make("designee", false);

  switch (props.geometryStatus) {
    case "text-only":
      return make("texte", false);
    case "lot-union-fallback":
      // Géométrie dérivée d'une union de lots = recalage sur le cadastre.
      return make("recalage", true);
    case "official":
      // Géométrie officielle OGC : provenance fine (site vs geojson-dans-PDF vs
      // recalage) non servie → « site » par défaut, marqué approximatif.
      return make("site", true);
    case "missing":
    default:
      return make("missing", false);
  }
}
