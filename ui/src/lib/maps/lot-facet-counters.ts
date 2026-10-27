/**
 * Independent lot facet counters for the post-cutover Evaluation view.
 *
 * One lot contributes to every active facet count independently; the
 * counts never sum to a population total. Legacy statuses map onto
 * facets through the 6J action replacement (pipeline/favori becomes
 * selection, pipeline/ecarte becomes archive), so the established
 * filter row keeps working with facet counts once activated.
 */
import type { ProspectStatus } from "$lib/prospect/prospect-marks-client.js";

/** Active pipeline value; null means no active pipeline facet. */
export type FacetPipelineStatus = "sollicite" | "lettre_envoyee";

/**
 * One destination target for the view. `key` uses the view's own lot
 * join key (`citySlug::noLot`); the parent wiring supplies the join and
 * no canonical derivation is invented here.
 */
export interface LotFacetState {
  key: string;
  selectionActive: boolean;
  pipelineStatus: FacetPipelineStatus | null;
  marketActive: boolean;
  archivedActive: boolean;
}

/** Independent per-facet counts over destination targets. */
export interface LotFacetCounters {
  total: number;
  selected: number;
  sollicite: number;
  lettreEnvoyee: number;
  enVente: number;
  archived: number;
  unmarked: number;
}

/** Filter values shared by the legacy mark row and the facet row. */
export type LotViewFilter = ProspectStatus | "selected" | "archived" | "all" | "unmarked";

/** Count every target once per active facet; never sum the facets. */
export function computeLotFacetCounters(states: LotFacetState[]): LotFacetCounters {
  const counters: LotFacetCounters = {
    total: states.length,
    selected: 0,
    sollicite: 0,
    lettreEnvoyee: 0,
    enVente: 0,
    archived: 0,
    unmarked: 0,
  };
  for (const state of states) {
    if (state.selectionActive) counters.selected += 1;
    if (state.pipelineStatus === "sollicite") counters.sollicite += 1;
    if (state.pipelineStatus === "lettre_envoyee") counters.lettreEnvoyee += 1;
    if (state.marketActive) counters.enVente += 1;
    if (state.archivedActive) counters.archived += 1;
    if (
      !state.selectionActive &&
      state.pipelineStatus === null &&
      !state.marketActive &&
      !state.archivedActive
    ) {
      counters.unmarked += 1;
    }
  }
  return counters;
}

/** Map one filter value onto its independent facet count. */
export function facetCounterFor(counters: LotFacetCounters, filter: LotViewFilter): number {
  switch (filter) {
    case "all":
      return counters.total;
    case "unmarked":
      return counters.unmarked;
    case "favori":
    case "selected":
      return counters.selected;
    case "ecarte":
    case "archived":
      return counters.archived;
    case "sollicite":
      return counters.sollicite;
    case "lettre_envoyee":
      return counters.lettreEnvoyee;
    default:
      return counters.enVente;
  }
}

/** True when the target carries the filtered facet (absent state counts as unmarked). */
export function lotMatchesFacetFilter(
  state: LotFacetState | null | undefined,
  filter: LotViewFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "unmarked") {
    return (
      state != null &&
      (!state.selectionActive &&
        state.pipelineStatus === null &&
        !state.marketActive &&
        !state.archivedActive)
    );
  }
  if (state == null) return false;
  if (filter === "favori" || filter === "selected") return state.selectionActive;
  if (filter === "ecarte" || filter === "archived") return state.archivedActive;
  if (filter === "sollicite") return state.pipelineStatus === "sollicite";
  if (filter === "lettre_envoyee") return state.pipelineStatus === "lettre_envoyee";
  return state.marketActive;
}
