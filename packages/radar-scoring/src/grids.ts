import type { AxisT } from "@radar/domain";

// Version is hardcoded here to avoid a circular import:
// index.ts re-exports grids.ts, so importing GRID_VERSION from index.ts would be circular.
// GRID_VERSION in index.ts is also "v1" — single source of truth is index.ts for external
// consumers; grids.ts carries its own local stamp.
const GRID_VERSION = "v1";

export const WEIGHTS: Record<AxisT, number> = {
  potentiel: 0.30,
  risque: 0.20,
  timing: 0.20,
  faisabilite: 0.15,
  marche: 0.15,
};

export interface AxisGrid {
  axis: AxisT;
  weight: number;
  version: string;
  levels: Record<0 | 1 | 2 | 3 | 4 | 5, string>;
}

export const GRIDS: Record<AxisT, AxisGrid> = {
  potentiel: {
    axis: "potentiel",
    weight: WEIGHTS.potentiel,
    version: GRID_VERSION,
    levels: {
      0: "No residential opening (zoning unchanged / non-residential).",
      1: "Negligible (minor derogation, no density gain).",
      2: "Minor opening (slight use/density tweak).",
      3: "Moderate residential opening (density/use clearly increased).",
      4: "Strong (markedly increased density/use — e.g. U→H conversion, conditional +50 log/ha).",
      5: "Major and aligned with municipal intentions (structural rezoning matching the plan d'urbanisme).",
    },
  },
  risque: {
    axis: "risque",
    weight: WEIGHTS.risque,
    version: GRID_VERSION,
    levels: {
      0: "Absolute blocker: permanently-protected agricultural zone with no dezoning demand / flood 0-20 yr / contamination.",
      1: "Severe: several heavy constraints (e.g. confirmed CPTAQ adjacency + riverain PPRLPI bands).",
      2: "Costly major: one heavy constraint, expensive mitigation.",
      3: "Negotiable / mitigable.",
      4: "Minor.",
      5: "No constraint.",
    },
  },
  timing: {
    axis: "timing",
    weight: WEIGHTS.timing,
    version: GRID_VERSION,
    levels: {
      0: "No catalyst.",
      1: "Very long horizon, no active process.",
      2: "Early signals.",
      3: "Process in progress (consultation / référendaire open).",
      4: "Advanced process (adopted, awaiting final adoption / PHV completed).",
      5: "Window open and low competitive visibility measured (proxy: no recent notarized transaction since the 1st project — Tier C → often non-disponible, marked hypothesis).",
    },
  },
  faisabilite: {
    axis: "faisabilite",
    weight: WEIGHTS.faisabilite,
    version: GRID_VERSION,
    levels: {
      0: "Infeasible (no buildable area, no access).",
      1: "Very constrained (tiny / landlocked).",
      2: "Difficult (zone fully built, assembly required / 0 vacant lot at rôle).",
      3: "Moderate (a large candidate lot exists; zone attribution is a hypothesis).",
      4: "Good (clear buildable lot + access; services likely).",
      5: "Excellent (large vacant lot, confirmed services, easy assembly).",
    },
  },
  marche: {
    axis: "marche",
    weight: WEIGHTS.marche,
    version: GRID_VERSION,
    levels: {
      0: "No market / declining absorption.",
      1: "Weak (high vacancy, slow absorption).",
      2: "Soft (below-average zone demand).",
      3: "Moderate (active demand, balanced — zone-level comparables present).",
      4: "Strong (tight, above-average absorption with zone comparables).",
      5: "Very tight (near-zero vacancy + zone comparables confirming a premium).",
    },
  },
};
