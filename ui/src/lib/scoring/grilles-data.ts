import { GRIDS, WEIGHTS } from "@radar/scoring";
import type { AxisT } from "@radar/domain";

/** Display label per axis (French UI copy). */
const AXIS_LABELS: Record<AxisT, string> = {
  potentiel: "Potentiel réglementaire",
  risque: "Risque de contrainte",
  timing: "Timing",
  faisabilite: "Faisabilité foncière",
  marche: "Valeur marché",
};

/** Presentation row for a single axis grid. */
export interface GrilleRow {
  axis: AxisT;
  label: string;
  /** Weight expressed as a percentage (0–100). */
  weightPct: number;
  version: string;
  levels: Record<0 | 1 | 2 | 3 | 4 | 5, string>;
}

/** Return one GrilleRow per axis, ordered as in GRIDS. */
export function toGrilleRows(): GrilleRow[] {
  return (Object.keys(GRIDS) as AxisT[]).map((axis) => {
    const grid = GRIDS[axis];
    return {
      axis,
      label: AXIS_LABELS[axis],
      weightPct: WEIGHTS[axis] * 100,
      version: grid.version,
      levels: { ...grid.levels },
    };
  });
}
