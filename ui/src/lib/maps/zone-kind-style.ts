/**
 * zone-kind-style — teinte des aplats de ZONE par kind (langage couleur du
 * zonage : résidentiel jaune, commercial rouge, industriel violet, agricole
 * vert…), dérivée des TOKENS catégoriels du design-system
 * (`--st-semantic-data-category1..8`) — aucune palette inventée.
 *
 * Parité concurrente (vue Signaux) : les zones ne sont plus des contours gris
 * uniformes mais des aplats doux distincts par famille, sous les lots colorés
 * par flags. Le kind est résolu de façon TOLÉRANTE :
 *   1. libellé `affectation` de la source quand présent — le plus fiable
 *      (« Conservation », « CV - Résidentielle de faible densité »…) ;
 *   2. sinon `kind` de la source : libellé (« habitation », « mixed-use »…),
 *      lettre canonique, ou code court de la taxonomie geo (« CO », « Rv »,
 *      « Af/b »… — `kindFromZoneCode`) ;
 *   3. sinon tokens du code de zone (H-431, CO-939… — `kindFromZoneCode`) ;
 *   4. sinon teinte neutre « Type non déterminé » (gris clair honnête,
 *      PAS blanc invisible) — aucune invention.
 */

import { kindFromZoneCode, type ZoneKind } from "./lot-potential-visual.js";
import {
  resolveToken,
  resolveMapColor,
  LOT_4PLUS_TOD_TOKEN,
  LOT_4PLUS_TOD_FALLBACK,
} from "./score-color-scale.js";
import type { GeoZoneFeatureCollection } from "./geo-zones-client.js";
import { zoneRefComparableKey } from "./signaux-map-geo.js";

export interface ZoneKindStyle {
  token: string;
  fallback: string;
  label: string;
}

/**
 * Teintes par kind canonique — tokens catégoriels DS (valeurs sent-tech en
 * fallback hors DOM). Choix aligné sur le langage couleur classique du
 * zonage municipal.
 */
export const ZONE_KIND_STYLES: Record<Exclude<ZoneKind, "AUTRE">, ZoneKindStyle> = {
  H: { token: "--st-semantic-data-category6", fallback: "#EDC948", label: "Habitation" },
  MIXTE: { token: "--st-semantic-data-category2", fallback: "#F28E2B", label: "Mixte" },
  C: { token: "--st-semantic-data-category3", fallback: "#E15759", label: "Commercial" },
  I: { token: "--st-semantic-data-category7", fallback: "#B07AA1", label: "Industriel" },
  P: { token: "--st-semantic-data-category1", fallback: "#4E79A7", label: "Public / institutionnel" },
  A: { token: "--st-semantic-data-category5", fallback: "#59A14F", label: "Agricole" },
  // CONS et REC partagent teinte ET libellé : une seule entrée de légende.
  CONS: { token: "--st-semantic-data-category4", fallback: "#76B7B2", label: "Conservation / récréation" },
  REC: { token: "--st-semantic-data-category4", fallback: "#76B7B2", label: "Conservation / récréation" },
  U: { token: "--st-semantic-data-category8", fallback: "#FF9DA7", label: "Utilité publique" },
};

/**
 * Teinte neutre d'une zone au kind irrésolu — gris clair HONNÊTE (« Type non
 * déterminé ») : un aplat blanc est invisible sur fond de carte clair et se
 * confond avec « pas de zonage ». Token surface-hover (gris slate léger, même
 * fallback que le reste du repo), survol grisé plus franc (cf. hover-paint).
 */
export const ZONE_KIND_NEUTRAL: ZoneKindStyle = {
  token: "--st-semantic-surface-hover",
  fallback: "#f1f5f9",
  label: "Type non déterminé",
};

/** Kind canonique porté par les styles (AUTRE exclu : rendu neutre). */
export type StyledZoneKind = Exclude<ZoneKind, "AUTRE">;

/** Pliage de libellé : accents retirés, majuscules, espaces bordure retirés. */
function foldLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

/**
 * Règles mot-clé → kind, appliquées SEGMENT par segment (ordre = priorité).
 * Taxonomie MESURÉE sur les collections geo `qc-zonage-*` (2026-07) : libellés
 * d'affectation FR (« Conservation et récréation », « Villégiature faunique »,
 * « Récréative et espace vert-Conservation »…) et kinds EN des villes du focus
 * (residential, mixed-use, institutional…).
 */
const LABEL_SEGMENT_RULES: ReadonlyArray<{
  kind: StyledZoneKind;
  keywords: readonly string[];
}> = [
  // Villégiature = habitat de villégiature (résidentiel saisonnier) — AVANT la
  // famille conservation pour que « Villégiature faunique » reste Habitation.
  { kind: "H", keywords: ["VILLEGIATURE"] },
  { kind: "CONS", keywords: ["CONSERV", "ECOLOG", "FAUNIQ", "PROTEC"] },
  { kind: "REC", keywords: ["RECRE", "LOISIR", "TOURIST", "ESPACE VERT", "PLEIN AIR"] },
  { kind: "H", keywords: ["HABIT", "RESID"] },
  // « Utilité publique » contient PUBL : UTIL doit primer.
  { kind: "U", keywords: ["UTIL"] },
  { kind: "P", keywords: ["PUBL", "INSTIT", "COMMUNAUT", "GOUVERN"] },
  { kind: "C", keywords: ["COMMERC"] },
  { kind: "I", keywords: ["INDUS", "EXTRACT"] },
  { kind: "A", keywords: ["AGRIC", "AGRO", "FOREST"] },
  // En dernier : « mixte » qualifie souvent une famille nommée plus haut
  // (« Industrielle mixte » → I) ; seul un libellé mixte « pur » tombe ici
  // (« Mixte », « Mixité de faible intensité », « Centralité urbaine »).
  { kind: "MIXTE", keywords: ["MIX", "CENTRALIT"] },
];

function kindFromLabelSegment(segment: string): StyledZoneKind | null {
  if (!segment) return null;
  for (const rule of LABEL_SEGMENT_RULES) {
    if (rule.keywords.some((keyword) => segment.includes(keyword))) return rule.kind;
  }
  return null;
}

/**
 * Kind canonique depuis un LIBELLÉ (affectation ou kind textuel). Les libellés
 * composites « Primaire-Sous-type » (« Forestière-Secteur de villégiature »,
 * « CV - Résidentielle de faible densité ») sont résolus segment par segment :
 * le premier segment résolu — l'affectation PRIMAIRE — l'emporte ; un préfixe
 * de secteur inconnu (« CV », « VA ») est simplement sauté. null si irrésolu.
 */
function kindFromLabel(label: string | null | undefined): StyledZoneKind | null {
  if (!label || label.trim().length === 0) return null;
  const segments = foldLabel(label).split(/[-–—/]/);
  for (const segment of segments) {
    const resolved = kindFromLabelSegment(segment.trim());
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Résout le kind canonique d'une zone, dans l'ordre de fiabilité :
 *   1. libellé `affectation` (« Conservation » → CONS, « CV - Résidentielle
 *      de faible densité » → H…) ;
 *   2. `kind` source : lettre canonique (« H »), libellé (« habitation »,
 *      « mixed-use »), ou code court de la taxonomie geo (« CO », « Rv »,
 *      « Af/b » — `kindFromZoneCode`) ;
 *   3. tokens du code de zone (H-431 → H, CO-939 → CONS).
 * null si irrésolu (teinte neutre, aucune invention).
 */
export function canonicalZoneKind(
  kind: string | null | undefined,
  code: string | null | undefined,
  affectation?: string | null,
): StyledZoneKind | null {
  const fromAffectation = kindFromLabel(affectation);
  if (fromAffectation) return fromAffectation;
  if (kind && kind.trim().length > 0) {
    const folded = foldLabel(kind);
    if (folded in ZONE_KIND_STYLES) return folded as StyledZoneKind;
    const fromKindLabel = kindFromLabel(kind);
    if (fromKindLabel) return fromKindLabel;
    const fromKindCode = kindFromZoneCode(kind);
    if (fromKindCode !== null && fromKindCode !== "AUTRE") return fromKindCode;
  }
  const fromCode = code ? kindFromZoneCode(code) : null;
  return fromCode !== null && fromCode !== "AUTRE" ? fromCode : null;
}

/** Style (token/fallback/label) d'une zone — neutre si kind irrésolu. */
export function zoneKindStyle(
  kind: string | null | undefined,
  code: string | null | undefined,
  affectation?: string | null,
): ZoneKindStyle {
  const canonical = canonicalZoneKind(kind, code, affectation);
  return canonical ? ZONE_KIND_STYLES[canonical] : ZONE_KIND_NEUTRAL;
}

/** Couleur RÉSOLUE (tokens DS de `el`, fallback sent-tech hors DOM). */
export function zoneKindColor(
  kind: string | null | undefined,
  code: string | null | undefined,
  el?: Element | null,
  affectation?: string | null,
): string {
  const style = zoneKindStyle(kind, code, affectation);
  return resolveMapColor(style.token, style.fallback, el);
}

/**
 * Décore les features de zone d'une propriété `kindColor` (couleur RÉSOLUE par
 * kind) consommée par l'expression de peinture STATIQUE
 * `["coalesce", ["get","kindColor"], neutre]`.
 *
 * Pourquoi une propriété plutôt qu'un `match` sur le code : les collections
 * réelles portent des codes DUPLIQUÉS (ex. Salaberry : C-186 ×2) qui font
 * échouer les branches `match` MapLibre ; et la couleur doit pouvoir changer
 * après la création de la couche (le socle ne re-pose pas `fill-color`).
 *
 * @param highlightComparableCodes - codes (forme comparable) des zones à
 *   SURLIGNER en vert 4+ (filtre données 4+/priorité actif) — prime sur le kind.
 */
export function decorateZonesWithKindColor(
  zones: GeoZoneFeatureCollection,
  highlightComparableCodes: ReadonlySet<string> = new Set(),
  el?: Element | null,
): GeoZoneFeatureCollection {
  if (zones.features.length === 0) return zones;
  const highlightColor = resolveMapColor(LOT_4PLUS_TOD_TOKEN, LOT_4PLUS_TOD_FALLBACK, el);
  return {
    ...zones,
    features: zones.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        kindColor: highlightComparableCodes.has(
          zoneRefComparableKey(feature.properties.code),
        )
          ? highlightColor
          : zoneKindColor(
              feature.properties.kind,
              feature.properties.code,
              el,
              feature.properties.affectation,
            ),
      },
    })),
  };
}

export interface ZoneKindLegendEntry {
  color: string;
  label: string;
}

/**
 * Entrées de légende pour les kinds RÉELLEMENT présents dans les zones
 * fournies (dédupliquées, ordre stable des styles). Zones au kind irrésolu →
 * une entrée neutre unique en fin de liste.
 */
export function zoneKindLegend(
  zones: ReadonlyArray<{ kind?: string | null; code: string; affectation?: string | null }>,
  el?: Element | null,
): ZoneKindLegendEntry[] {
  const seen = new Set<StyledZoneKind>();
  let hasNeutral = false;
  for (const zone of zones) {
    const canonical = canonicalZoneKind(zone.kind ?? null, zone.code, zone.affectation ?? null);
    if (canonical) seen.add(canonical);
    else hasNeutral = true;
  }
  const entries: ZoneKindLegendEntry[] = [];
  const emittedLabels = new Set<string>();
  for (const [kind, style] of Object.entries(ZONE_KIND_STYLES) as Array<
    [StyledZoneKind, ZoneKindStyle]
  >) {
    if (!seen.has(kind) || emittedLabels.has(style.label)) continue;
    emittedLabels.add(style.label);
    entries.push({ color: resolveToken(style.token, style.fallback, el), label: style.label });
  }
  if (hasNeutral) {
    entries.push({
      color: resolveToken(ZONE_KIND_NEUTRAL.token, ZONE_KIND_NEUTRAL.fallback, el),
      label: ZONE_KIND_NEUTRAL.label,
    });
  }
  return entries;
}
