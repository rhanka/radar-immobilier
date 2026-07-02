/**
 * zone-kind-style — teinte des aplats de ZONE par kind (langage couleur du
 * zonage : résidentiel jaune, commercial rouge, industriel violet, agricole
 * vert…), dérivée des TOKENS catégoriels du design-system
 * (`--st-semantic-data-category1..8`) — aucune palette inventée.
 *
 * Parité concurrente (vue Signaux) : les zones ne sont plus des contours gris
 * uniformes mais des aplats doux distincts par famille, sous les lots colorés
 * par flags. Le kind est résolu de façon TOLÉRANTE :
 *   1. libellé `kind` de la source quand présent (« habitation », « commerce »,
 *      lettre canonique…) ;
 *   2. sinon préfixe du code de zone (H-, C-, I-, A-… — `kindFromZoneCode`) ;
 *   3. sinon teinte neutre (gris discret) — aucune invention.
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

/** Teinte neutre d'une zone au kind irrésolu (gris discret, token DS). */
export const ZONE_KIND_NEUTRAL: ZoneKindStyle = {
  token: "--st-semantic-text-muted",
  fallback: "#64748b",
  label: "Type non déterminé",
};

/** Kind canonique porté par les styles (AUTRE exclu : rendu neutre). */
export type StyledZoneKind = Exclude<ZoneKind, "AUTRE">;

/**
 * Résout le kind canonique d'une zone depuis son libellé `kind` (tolérant aux
 * variantes FR : « habitation », « résidentiel », « commerce »…) puis, à
 * défaut, depuis le préfixe de son code (H-431 → H). null si irrésolu.
 */
export function canonicalZoneKind(
  kind: string | null | undefined,
  code: string | null | undefined,
): StyledZoneKind | null {
  if (kind && kind.trim().length > 0) {
    const folded = kind
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .trim();
    if (folded in ZONE_KIND_STYLES) return folded as StyledZoneKind;
    if (folded.startsWith("HABIT") || folded.startsWith("RESID")) return "H";
    if (folded.startsWith("MIXT")) return "MIXTE";
    if (folded.startsWith("COMM")) return "C";
    if (folded.startsWith("INDUS")) return "I";
    if (
      folded.startsWith("PUBL") ||
      folded.startsWith("INSTIT") ||
      folded.startsWith("COMMUNAUT")
    ) {
      return "P";
    }
    if (folded.startsWith("AGRIC")) return "A";
    if (folded.startsWith("CONSERV")) return "CONS";
    if (folded.startsWith("RECRE") || folded.startsWith("LOISIR")) return "REC";
    if (folded.startsWith("UTIL")) return "U";
  }
  const fromCode = code ? kindFromZoneCode(code) : null;
  return fromCode !== null && fromCode !== "AUTRE" ? fromCode : null;
}

/** Style (token/fallback/label) d'une zone — neutre si kind irrésolu. */
export function zoneKindStyle(
  kind: string | null | undefined,
  code: string | null | undefined,
): ZoneKindStyle {
  const canonical = canonicalZoneKind(kind, code);
  return canonical ? ZONE_KIND_STYLES[canonical] : ZONE_KIND_NEUTRAL;
}

/** Couleur RÉSOLUE (tokens DS de `el`, fallback sent-tech hors DOM). */
export function zoneKindColor(
  kind: string | null | undefined,
  code: string | null | undefined,
  el?: Element | null,
): string {
  const style = zoneKindStyle(kind, code);
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
          : zoneKindColor(feature.properties.kind, feature.properties.code, el),
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
  zones: ReadonlyArray<{ kind?: string | null; code: string }>,
  el?: Element | null,
): ZoneKindLegendEntry[] {
  const seen = new Set<StyledZoneKind>();
  let hasNeutral = false;
  for (const zone of zones) {
    const canonical = canonicalZoneKind(zone.kind ?? null, zone.code);
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
