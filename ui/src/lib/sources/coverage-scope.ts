/**
 * coverage-scope — PORTÉES de la vue Sources/Couverture (sélecteur radio
 * MUTUELLEMENT EXCLUSIF du rail gauche) :
 *
 *   - "qa4"     : « Focus QA : 4 villes » — les 4 villes de contrôle/QA
 *                 (carte Steve : Delson, Sainte-Catherine, Saint-Constant,
 *                 Candiac). Source de vérité : `REFERENCE_CITIES`
 *                 ($lib/maps/reference-cities) — AUCUN slug re-hardcodé ici.
 *   - "focus30" : « 30 villes à signaux » — même critère que le Focus 30 de la
 *                 Console (`isFocusCity`, priorityRank ≤ 30).
 *   - "all"     : « Toutes » — la province entière (1104/1106). DÉFAUT —
 *                 comportement « Province » historique de la carte Couverture.
 *
 * La portée pilote À LA FOIS la liste de villes du rail (filtre) et la
 * coloration carte (surbrillance d'opacité : villes de la portée opaques, le
 * reste atténué — même mécanique que l'ancien toggle Focus 30, D3 : un
 * HIGHLIGHT, pas un recompute).
 */
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import { REFERENCE_CITIES } from "$lib/maps/reference-cities.js";
import {
  isFocusCity,
  type CityCoverage,
} from "./source-coverage-client.js";

export type CoverageScope = "qa4" | "focus30" | "all";

/** Défaut : « Toutes » (comportement Province historique). */
export const DEFAULT_COVERAGE_SCOPE: CoverageScope = "all";

/** Slugs des villes QA — dérivés de la constante canonique REFERENCE_CITIES. */
export const QA_REFERENCE_SLUGS: ReadonlySet<string> = new Set(
  REFERENCE_CITIES.map((c) => c.slug),
);

export interface CoverageScopeOption {
  value: CoverageScope;
  label: string;
  helperText: string;
}

/** Options du sélecteur radio (ordre d'affichage du rail). */
export const COVERAGE_SCOPE_OPTIONS: CoverageScopeOption[] = [
  {
    value: "qa4",
    label: `Focus QA : ${REFERENCE_CITIES.length} villes`,
    helperText: REFERENCE_CITIES.map((c) => c.name).join(" · "),
  },
  {
    value: "focus30",
    label: "30 villes à signaux",
    helperText: "priorité ≤ 30 (focus 30)",
  },
  {
    value: "all",
    label: "Toutes",
    helperText: "province entière",
  },
];

/** Une ville est-elle l'une des 4 villes de contrôle/QA ? */
export function isQaReferenceCity(
  city: Pick<CityCoverage, "citySlug">,
): boolean {
  return QA_REFERENCE_SLUGS.has(city.citySlug);
}

/** Prédicat d'appartenance d'une ville à une portée. */
export function cityInScope(
  city: CityCoverage,
  scope: CoverageScope,
): boolean {
  if (scope === "qa4") return isQaReferenceCity(city);
  if (scope === "focus30") return isFocusCity(city);
  return true;
}

/** Villes de la portée (ordre d'entrée préservé). */
export function filterCitiesByScope(
  cities: CityCoverage[],
  scope: CoverageScope,
): CityCoverage[] {
  if (scope === "all") return cities;
  return cities.filter((city) => cityInScope(city, scope));
}

/** Compte de villes dans une portée (badges du rail). */
export function countCitiesInScope(
  cities: CityCoverage[],
  scope: CoverageScope,
): number {
  return filterCitiesByScope(cities, scope).length;
}

// ── Coloration carte par portée ───────────────────────────────────────────────
// Constantes IDENTIQUES à `buildFocusOpacityExpression` (source-coverage-client)
// dont cette expression généralise le régime Focus 30 aux 3 portées — la parité
// est ÉPINGLÉE par test (coverage-scope.test.ts).
const PROVINCE_OPACITY = 0.62;
const SCOPE_OPACITY = 0.88;
const DIMMED_OPACITY = 0.18;

/**
 * Expression `fill-opacity` MapLibre par portée :
 *   - "all"      : opacité uniforme (toutes les villes visibles) ;
 *   - "focus30"  : villes priorityRank ≤ 30 opaques, le reste atténué ;
 *   - "qa4"      : les 4 villes QA opaques, le reste atténué.
 * Villes hors couverture (fallback) : atténuées dès qu'une portée restreinte
 * est active (elles n'en font pas partie).
 */
export function buildScopeOpacityExpression(
  cities: CityCoverage[],
  scope: CoverageScope,
): ExpressionSpecification {
  if (scope === "all" || cities.length === 0) {
    return PROVINCE_OPACITY as unknown as ExpressionSpecification;
  }
  const expr: unknown[] = ["match", ["get", "citySlug"]];
  for (const city of cities) {
    expr.push(
      city.citySlug,
      cityInScope(city, scope) ? SCOPE_OPACITY : DIMMED_OPACITY,
    );
  }
  expr.push(DIMMED_OPACITY);
  return expr as ExpressionSpecification;
}
