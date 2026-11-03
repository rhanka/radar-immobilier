/**
 * Frozen `filter.*` -> SignalFilterV1 mapping for lot I-0.
 *
 * Pure table + documented translator. Nothing here is wired into any
 * component, so importing it changes no production behaviour. I-2 implements
 * the server side of the same mapping.
 */

export type FilterMappingTarget =
  | { readonly kind: "contract"; readonly field: string }
  | { readonly kind: "client-resolved"; readonly field: string }
  | { readonly kind: "out-of-scope"; readonly reason: string };

/**
 * Exhaustive over every stripped `filter.*` key understood by
 * `readGeoFilters` / `writeGeoFilters` (plus the two legacy markers).
 * Stripped key = URL spelling after the `filter.` prefix.
 */
export const FILTER_TO_CONTRACT: Record<string, FilterMappingTarget> = {
  zonage: { kind: "contract", field: "requireZonage" },
  residentiel: { kind: "contract", field: "requireResidentielEligible" },
  precoce: { kind: "contract", field: "requirePrecoce" },
  excludePiia: { kind: "contract", field: "excludePiia" },
  excludeDerogations: { kind: "contract", field: "excludeDerogations" },
  period: { kind: "client-resolved", field: "dateFrom/dateTo (relative preset resolved to civil dates at open)" },
  dateFrom: { kind: "contract", field: "dateFrom" },
  dateTo: { kind: "contract", field: "dateTo" },
  dateBasis: { kind: "contract", field: "dateBasis" },
  showDiscarded: { kind: "contract", field: "archive (1 = include, absent = exclude; only has no URL spelling)" },
  lotCategory: { kind: "out-of-scope", reason: "LotFilterV1 (I-9b), never a SignalFilterV1 field" },
  lotUsage: { kind: "out-of-scope", reason: "LotFilterV1 (I-9b), never a SignalFilterV1 field" },
  lotMinArea: { kind: "out-of-scope", reason: "LotFilterV1 (I-9b), never a SignalFilterV1 field" },
  zoneKind: { kind: "out-of-scope", reason: "ZoneFilterV1 (I-9a), never a SignalFilterV1 field" },
  zoneMillesime: { kind: "out-of-scope", reason: "ZoneFilterV1 (I-9a), never a SignalFilterV1 field" },
  lots: { kind: "out-of-scope", reason: "Layer visibility (painting), not a filter predicate" },
  cptaq: { kind: "out-of-scope", reason: "Layer visibility (painting), not a filter predicate" },
  citySearch: { kind: "out-of-scope", reason: "Presentation search over the byCity facet, not a predicate" },
  zoneSearch: { kind: "out-of-scope", reason: "Presentation search over already-filtered zones" },
  lotSearch: { kind: "out-of-scope", reason: "Presentation search over already-filtered lots" },
  subset: { kind: "client-resolved", field: "legacy vivier key, normalized to B axes before mapping" },
  legacyLayers: { kind: "out-of-scope", reason: "Legacy zones-only marker, maps to product defaults" },
};

/** Stripped keys read or written by the geo filter state (authoritative set). */
export const GEO_FILTER_STATE_KEYS: readonly string[] = [
  "zonage",
  "residentiel",
  "precoce",
  "excludePiia",
  "excludeDerogations",
  "period",
  "dateFrom",
  "dateTo",
  "dateBasis",
  "lotCategory",
  "lotUsage",
  "lotMinArea",
  "zoneKind",
  "zoneMillesime",
  "showDiscarded",
  "lots",
  "cptaq",
  "citySearch",
  "zoneSearch",
  "lotSearch",
  "subset",
  "legacyLayers",
];
