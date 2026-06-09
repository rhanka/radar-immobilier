import type { SourceKind } from "@radar/domain";

export type SourceRecommendation =
  | "build-now"
  | "build-later"
  | "manual-check"
  | "partner-required"
  | "drop-for-phase-1";

export type SourceTier = "A" | "B" | "C";

export interface PrioritySourceBinding {
  readonly sourceId: string;
  readonly priority: 1 | 2 | 3 | 4 | 5;
  readonly tier: SourceTier;
  readonly kind: SourceKind;
  readonly city?: string;
  readonly recommendation: SourceRecommendation;
  readonly cadence: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
}

export const VALLEYFIELD_PRIORITY_SOURCE_BINDINGS = [
  {
    sourceId: "avis-publics-valleyfield",
    priority: 1,
    tier: "A",
    kind: "avis-publics",
    city: "salaberry-de-valleyfield",
    recommendation: "build-now",
    cadence: "daily",
  },
  {
    sourceId: "reglements-urbanisme-valleyfield",
    priority: 2,
    tier: "A",
    kind: "reglement",
    city: "salaberry-de-valleyfield",
    recommendation: "build-now",
    cadence: "weekly",
  },
  {
    sourceId: "roles-evaluation-fonciere-mamh",
    priority: 3,
    tier: "A",
    kind: "role-evaluation",
    recommendation: "build-now",
    cadence: "annual",
  },
  {
    sourceId: "donnees-quebec-catalog",
    priority: 4,
    tier: "A",
    kind: "donnees-quebec",
    recommendation: "build-now",
    cadence: "monthly",
  },
  {
    sourceId: "adresses-quebec-igo-geocoder",
    priority: 4,
    tier: "A",
    kind: "adresses-quebec",
    recommendation: "build-now",
    cadence: "monthly",
  },
  {
    sourceId: "cptaq-zone-agricole",
    priority: 5,
    tier: "A",
    kind: "cptaq",
    recommendation: "build-now",
    cadence: "quarterly",
  },
] as const satisfies readonly PrioritySourceBinding[];

/**
 * Beauharnois priority bindings (WP4 Source #2 — the second pilot city, first on
 * a different CMS). Kept in a separate array so the Valleyfield top-five stays
 * pinned; `getPrioritySourceBinding` resolves across both city plans.
 */
export const BEAUHARNOIS_PRIORITY_SOURCE_BINDINGS = [
  {
    sourceId: "avis-publics-beauharnois",
    priority: 1,
    tier: "A",
    kind: "avis-publics",
    city: "beauharnois",
    recommendation: "build-now",
    cadence: "daily",
  },
  {
    sourceId: "roles-evaluation-fonciere-mamh-beauharnois",
    priority: 3,
    tier: "A",
    kind: "role-evaluation",
    city: "beauharnois",
    recommendation: "build-now",
    cadence: "annual",
  },
] as const satisfies readonly PrioritySourceBinding[];

/** Every registered priority binding across all pilot cities. */
export const ALL_PRIORITY_SOURCE_BINDINGS: readonly PrioritySourceBinding[] = [
  ...VALLEYFIELD_PRIORITY_SOURCE_BINDINGS,
  ...BEAUHARNOIS_PRIORITY_SOURCE_BINDINGS,
];

export function getPrioritySourceBinding(
  sourceId: string,
): PrioritySourceBinding | undefined {
  return ALL_PRIORITY_SOURCE_BINDINGS.find(
    (source) => source.sourceId === sourceId,
  );
}
