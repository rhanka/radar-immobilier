/**
 * Physical pre-filters — run BEFORE creating T2 dossiers.
 *
 * Geometric contiguity detection is DEFERRED (spec §9): this function
 * consumes pre-computed `contiguityGroups: string[][]` (lists of noLot ids)
 * supplied by the caller.
 *
 * `excludeRecentBuiltMicroLots` is present in the config as a named flag but
 * NOT YET ENFORCED: it requires a recent-construction date field that is not
 * part of the current PreFilterLot shape. It is intentionally left as a
 * documented no-op pending the data source (spec §9).
 *
 * `maxBuildingToLandValueRatio`: a lot is dropped when its
 * `buildingToLandValueRatio` is present AND >= cfg.maxBuildingToLandValueRatio,
 * UNLESS the lot belongs to a contiguity group (assembly overrides ratio drop).
 */

export interface PreFilterConfig {
  /** Minimum lot area in m² to pass area filter. Default: 350. */
  minLotAreaM2: number;
  /**
   * Maximum building-to-land value ratio allowed.
   * A lot with buildingToLandValueRatio >= this value is dropped
   * (unless rescued by contiguity assembly). Default: 0.80.
   */
  maxBuildingToLandValueRatio: number;
  /**
   * When true, micro-lots with a recent construction should be excluded.
   * NOT YET ENFORCED — requires recent-construction date field (spec §9).
   */
  excludeRecentBuiltMicroLots: boolean;
}

export const DEFAULT_PREFILTERS: PreFilterConfig = {
  minLotAreaM2: 350,
  maxBuildingToLandValueRatio: 0.80,
  excludeRecentBuiltMicroLots: true,
};

/** Minimal lot shape required by pre-filters. Extra properties pass through. */
export interface PreFilterLot {
  noLot: string;
  areaM2?: number;
  confirmed?: boolean;
  assemblyClusterId?: string;
  buildingToLandValueRatio?: number;
  [k: string]: unknown;
}

/**
 * Apply pre-filters to a list of lots.
 *
 * @param lots - Lots to evaluate (not mutated).
 * @param cfg - Filter configuration.
 * @param contiguityGroups - Pre-computed groups of adjacent noLot ids.
 *   Each inner array is one contiguous cluster. A lot referenced here is
 *   exempted from the area and ratio drops, and gains an `assemblyClusterId`.
 * @returns `{ kept, dropped }` — new lot objects; inputs are never mutated.
 */
export function applyPreFilters<L extends PreFilterLot>(
  lots: L[],
  cfg: PreFilterConfig,
  contiguityGroups: string[][],
): { kept: L[]; dropped: L[] } {
  // Build noLot → clusterId map from contiguityGroups
  const clusterIdByLot = new Map<string, string>();
  for (const group of contiguityGroups) {
    // Stable cluster id derived from sorted member ids
    const clusterId = `assembly-${group.slice().sort().join("-")}`;
    for (const noLot of group) {
      clusterIdByLot.set(noLot, clusterId);
    }
  }

  const kept: L[] = [];
  const dropped: L[] = [];

  for (const lot of lots) {
    const clusterId = clusterIdByLot.get(lot.noLot);
    const inCluster = clusterId !== undefined;

    // Area filter: drop if areaM2 is known and below threshold
    const failsArea =
      lot.areaM2 !== undefined && lot.areaM2 < cfg.minLotAreaM2;

    // Ratio filter: drop if buildingToLandValueRatio is known and >= max
    const failsRatio =
      lot.buildingToLandValueRatio !== undefined &&
      lot.buildingToLandValueRatio >= cfg.maxBuildingToLandValueRatio;

    // A lot in a contiguity group is always kept (assembly override)
    const shouldDrop = !inCluster && (failsArea || failsRatio);

    if (shouldDrop) {
      dropped.push({ ...lot });
    } else {
      // Attach assemblyClusterId for cluster members (new object, no mutation)
      kept.push(inCluster ? { ...lot, assemblyClusterId: clusterId } : { ...lot });
    }
  }

  return { kept, dropped };
}
