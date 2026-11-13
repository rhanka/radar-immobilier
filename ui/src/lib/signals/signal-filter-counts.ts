/**
 * Filtre dropdown counts (owner 2026-11-09, scope fixed 2026-11-13): how many
 * signals each Filtre criterion keeps — or hides, for an exclusion — over the
 * WHOLE displayed perimeter (every city of the rail, « N signaux · M villes »),
 * with or without a selected city. Pure, no I/O.
 *
 * Source = the Filtre cube (`@radar/domain` filtre-cube):
 *  - every city: the cubes served by the by-city aggregate (period, archive
 *    visibility), merged only for the checked Pertinence classes;
 *  - the selected city, once its detail is loaded: the cube rebuilt from that
 *    detail scoped by period + Pertinence, exactly like the header swaps in
 *    the selected city's live count.
 *
 * Counting is faceted: a criterion is counted over the signals that pass every
 * OTHER active criterion (see `facetedVivierFiltreCounts`). Each count thus
 * follows the period, the Pertinence and the other Filtre boxes, and an
 * exclusion count stays informative once checked (it never reads 0 just
 * because the signals it hides are hidden).
 *
 * Any unusable source (a city without a served cube, a detail node without a
 * classification) makes the whole result `null`: no partial count is ever
 * shown as exact.
 */
import {
  addToVivierFiltreCube,
  facetedVivierFiltreCounts,
  mergeVivierFiltreCubes,
  type VivierBExclusions,
  type VivierFiltreAxes,
  type VivierFiltreCounts,
  type VivierFiltreCube,
} from "@radar/domain";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";
import type { CityMapEntry } from "$lib/maps/maps-data.js";
import { DEFAULT_CLASSEMENT_FILTER, SIGNAL_CLASSES, type ClassementFilter } from "./signal-classement.js";

export type FiltreCounts = VivierFiltreCounts;

/** Cube of loaded detail nodes, or `null` when a node carries no classification. */
export function filtreCubeOfNodes(nodes: readonly GraphSignalNode[]): VivierFiltreCube | null {
  const cube: VivierFiltreCube = {};
  for (const node of nodes) {
    const classification = node.classification;
    if (!classification) return null;
    addToVivierFiltreCube(cube, { ...node, classification });
  }
  return cube;
}

export interface FiltrePerimeterInput {
  /** Every city of the by-city aggregate (cities without signals included). */
  entries: readonly Pick<CityMapEntry, "municipality" | "vivierV2Counts" | "filtreCube" | "filtreCubesByClassement">[];
  classement?: ClassementFilter;
  axes: VivierFiltreAxes;
  exclusions: VivierBExclusions;
  /**
   * Selected city whose loaded detail replaces its bulk cube, with its nodes
   * already scoped by period + Pertinence. `null`: no selection, or detail not
   * loaded yet (the bulk cube stays, as for the header count).
   */
  live: { slug: string; nodes: readonly GraphSignalNode[] } | null;
}

export function filtreCountsForPerimeter(input: FiltrePerimeterInput): FiltreCounts | null {
  const cubes: VivierFiltreCube[] = [];
  const filter = input.classement ?? DEFAULT_CLASSEMENT_FILTER;
  if (!SIGNAL_CLASSES.some((classe) => filter[classe])) {
    return facetedVivierFiltreCounts({}, input.axes, input.exclusions);
  }
  for (const entry of input.entries) {
    if (input.live && entry.municipality.slug === input.live.slug) continue;
    // A city absent from the aggregate has no signal in scope: nothing to add.
    const cube = entry.filtreCube ?? null;
    if (entry.vivierV2Counts === null && cube === null) continue;
    if (entry.filtreCubesByClassement) {
      cubes.push(...SIGNAL_CLASSES.filter((classe) => filter[classe])
        .map((classe) => entry.filtreCubesByClassement![classe]));
    } else {
      // Older API: its visible cube is exact only with every visible class on.
      if (cube === null || !filter.pertinent || !filter.a_surveiller || !filter.non_classe) return null;
      cubes.push(cube);
    }
  }
  if (input.live) {
    const liveCube = filtreCubeOfNodes(input.live.nodes);
    if (liveCube === null) return null;
    cubes.push(liveCube);
  }
  return facetedVivierFiltreCounts(mergeVivierFiltreCubes(cubes), input.axes, input.exclusions);
}
