/**
 * zone-overlay-style — style des overlays zone SELON le mode de fond (§5, 2 modes).
 *
 * En mode PLAN (fond OSM / neutral-gray), les APLATS de zone portent la MEANING :
 * `fill-color` = teinte famille, `fill-opacity` = l'expression immo fournie par la
 * vue (survol inclus), contour sombre fin. Style STRICTEMENT INCHANGÉ vs l'existant.
 *
 * En mode SATELLITE, l'imagerie doit transparaître : l'aplat passe à
 * `fill-opacity` 0 tout en GARDANT sa `fill-color` famille comme HIT-AREA (une
 * feature à opacité 0 reste cliquable/queryable en MapLibre), et la MEANING migre
 * vers le CONTOUR : trait couleur-FAMILLE épais + liseré sombre (« casing »)
 * haut-contraste dessous, pour rester lisible sur toute imagerie.
 *
 * Valeurs INTERIM geo-archi §5 2-modes, pending ratif DS tokens + owner.
 */

/** Contour sombre du mode PLAN (inchangé, socle actuel). */
export const ZONE_OUTLINE_PLAN_COLOR = "#0f172a";
export const ZONE_OUTLINE_PLAN_WIDTH = 1.25;
export const ZONE_OUTLINE_PLAN_OPACITY = 0.5;

/** INTERIM — contour couleur-FAMILLE du mode SATELLITE. */
export const ZONE_OUTLINE_SAT_WIDTH = 2.25;
export const ZONE_OUTLINE_SAT_OPACITY = 1;

/**
 * Casing (liseré sombre) posé SOUS le contour famille en satellite (contour
 * ~2.25 + ~1.75 de casing = 4). Masqué en mode plan (opacité 0).
 *
 * Couleur RATIFIÉE design-system : token DS `--st-foundation-color-slate-90`,
 * theme-INVARIANT (token de FONDATION, PAS un token sémantique qui flippe en
 * dark) — résolu en amont via `resolveMapColor` puis passé en `casingColor`.
 * Largeur/opacité restent des valeurs carto geo-owned (INTERIM, non ratifiées DS).
 */
export const ZONE_CASING_TOKEN = "--st-foundation-color-slate-90";
export const ZONE_CASING_FALLBACK = "#0f172a";
export const ZONE_CASING_SAT_WIDTH = 4;
export const ZONE_CASING_SAT_OPACITY = 0.6;

/** Opacité de l'aplat zone en satellite : 0 (l'imagerie transparaît). */
export const ZONE_FILL_SAT_OPACITY = 0;

/**
 * Peinture des 3 couches d'overlay zone (`selected-zones-fill`,
 * `selected-zones-outline-casing`, `selected-zones-outline`) selon le mode.
 * Les valeurs `unknown` sont des expressions MapLibre opaques (couleur famille,
 * opacité de base) fournies par la vue et repassées telles quelles.
 */
export interface ZoneOverlayPaint {
  /** `selected-zones-fill`. */
  fill: {
    "fill-color": unknown;
    "fill-opacity": unknown;
  };
  /** `selected-zones-outline`. */
  outline: {
    "line-color": unknown;
    "line-width": number;
    "line-opacity": number;
  };
  /** `selected-zones-outline-casing` (liseré sombre sous le contour). */
  casing: {
    "line-color": string;
    "line-width": number;
    "line-opacity": number;
  };
}

/**
 * Calcule la peinture des overlays zone en fonction du mode de fond.
 *
 * @param satelliteActive `true` si le fond satellite est actif (mode contour),
 *   `false` en mode plan (mode aplats — inchangé).
 * @param familyColorExpr expression/constante `fill-color` = teinte FAMILLE.
 * @param baseOpacityExpr expression/constante d'opacité d'aplat du mode plan
 *   (immo, survol inclus) — repassée telle quelle, jamais durcie en numérique.
 * @param casingColor couleur du liseré casing (`line-color`), DÉJÀ résolue depuis
 *   le token DS `ZONE_CASING_TOKEN` via `resolveMapColor` (theme-invariant).
 *   Défaut = `ZONE_CASING_FALLBACK`. Appliquée dans les deux modes (plan reste
 *   masqué par son opacité 0).
 */
export function zoneOverlayPaint(
  satelliteActive: boolean,
  familyColorExpr: unknown,
  baseOpacityExpr: unknown,
  casingColor: string = ZONE_CASING_FALLBACK,
): ZoneOverlayPaint {
  if (satelliteActive) {
    return {
      // Hit-area : `fill-color` famille CONSERVÉE, `fill-opacity` 0 → l'imagerie
      // transparaît sans perdre la cible de clic/hover.
      fill: {
        "fill-color": familyColorExpr,
        "fill-opacity": ZONE_FILL_SAT_OPACITY,
      },
      // MEANING portée par le contour famille épais.
      outline: {
        "line-color": familyColorExpr,
        "line-width": ZONE_OUTLINE_SAT_WIDTH,
        "line-opacity": ZONE_OUTLINE_SAT_OPACITY,
      },
      // Liseré sombre haut-contraste sous le trait famille (couleur token DS).
      casing: {
        "line-color": casingColor,
        "line-width": ZONE_CASING_SAT_WIDTH,
        "line-opacity": ZONE_CASING_SAT_OPACITY,
      },
    };
  }
  // Mode PLAN — STRICTEMENT identique au socle actuel.
  return {
    fill: {
      "fill-color": familyColorExpr,
      "fill-opacity": baseOpacityExpr,
    },
    outline: {
      "line-color": ZONE_OUTLINE_PLAN_COLOR,
      "line-width": ZONE_OUTLINE_PLAN_WIDTH,
      "line-opacity": ZONE_OUTLINE_PLAN_OPACITY,
    },
    // Casing masqué en plan (couche présente mais invisible → aucune régression).
    casing: {
      "line-color": casingColor,
      "line-width": ZONE_CASING_SAT_WIDTH,
      "line-opacity": 0,
    },
  };
}
