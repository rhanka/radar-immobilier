/**
 * Filtre cube of the B view: the signal count of each combination of the five
 * Filtre criteria, so the Filtre dropdown counts can be computed for ANY state
 * of the axes and exclusions without reloading every city detail.
 *
 * A cell key is five `0`/`1` flags, in this order:
 *   z — zonage `oui` (Zonage axis);
 *   r — residential eligibility, `isResidentialEligible` (Résidentiel axis);
 *   p — early stage, `avis_motion` or `projet_reglement` (Précoce axis);
 *   i — hidden by « Exclure PIIA sans projet résidentiel »;
 *   d — hidden by « Exclure dérogations mineures ».
 *
 * Only the B universe is counted: a record with `exclusion_reason !== null` is
 * outside B for every Filtre state (parity with `countVivierClassifications`).
 * The server builds one cube per city (by-city aggregate); the client builds
 * the selected city's cube from its loaded detail. Both use this module, so the
 * two sources cannot diverge.
 */
import { z } from "zod";
import { isResidentialEligible } from "./counts.js";
import type { VivierV2 } from "./vivier-v2.js";
import {
  isHiddenByVivierBExclusions,
  type VivierBExclusions,
  type VivierDisplayNode,
} from "../signals/vivier-display-exclusions.js";

export const vivierFiltreCubeSchema = z.record(
  z.string().regex(/^[01]{5}$/),
  z.number().int().nonnegative(),
);

/** Cell key (`zripd` flags) -> signal count. Absent cells are 0. */
export type VivierFiltreCube = Record<string, number>;

/** Additive by-city dimension; the original five-flag cube stays unchanged. */
export const vivierFiltreCubesByClassementSchema = z.object({
  pertinent: vivierFiltreCubeSchema,
  a_surveiller: vivierFiltreCubeSchema,
  non_classe: vivierFiltreCubeSchema,
  ecarte: vivierFiltreCubeSchema,
}).strict();
export type VivierFiltreCubesByClassement = z.infer<typeof vivierFiltreCubesByClassementSchema>;

/** The three combinable B axes (all checked by default). */
export interface VivierFiltreAxes {
  z: boolean;
  r: boolean;
  p: boolean;
}

/** Per-criterion counts shown by the Filtre dropdown. */
export interface VivierFiltreCounts {
  /** Zonage axis. */
  z: number;
  /** Résidentiel axis. */
  r: number;
  /** Précoce axis. */
  p: number;
  /** Signals hidden by « Exclure PIIA sans projet résidentiel ». */
  piia: number;
  /** Signals hidden by « Exclure dérogations mineures ». */
  derog: number;
}

/** A record as both readers see it: display fields plus the server classification. */
export type VivierFiltreRecord = VivierDisplayNode & { classification: VivierV2 };

const PRECOCE_ETAPES: ReadonlySet<string> = new Set(["avis_motion", "projet_reglement"]);
const ONLY_PIIA: VivierBExclusions = { piiaSansProjetResidentiel: true, derogationsMineures: false };
const ONLY_DEROG: VivierBExclusions = { piiaSansProjetResidentiel: false, derogationsMineures: true };

const bit = (value: boolean): string => (value ? "1" : "0");

/** Cell key of one record, or `null` when the record is outside B. */
export function vivierFiltreCubeKey(record: VivierFiltreRecord): string | null {
  const classification = record.classification;
  if (classification.exclusion_reason !== null) return null;
  return bit(classification.zonage.valeur === "oui")
    + bit(isResidentialEligible(classification))
    + bit(PRECOCE_ETAPES.has(classification.etape))
    + bit(isHiddenByVivierBExclusions(record, ONLY_PIIA))
    + bit(isHiddenByVivierBExclusions(record, ONLY_DEROG));
}

/** Add one record to a cube (no-op for a record outside B). */
export function addToVivierFiltreCube(cube: VivierFiltreCube, record: VivierFiltreRecord): void {
  const key = vivierFiltreCubeKey(record);
  if (key !== null) cube[key] = (cube[key] ?? 0) + 1;
}

/** Sum cubes (cities) into one cube. */
export function mergeVivierFiltreCubes(cubes: readonly VivierFiltreCube[]): VivierFiltreCube {
  const merged: VivierFiltreCube = {};
  for (const cube of cubes) {
    for (const [key, count] of Object.entries(cube)) merged[key] = (merged[key] ?? 0) + count;
  }
  return merged;
}

type Criterion = keyof VivierFiltreCounts;

/**
 * Faceted counts: each criterion is counted over the signals that pass every
 * OTHER active criterion, never its own.
 *  - An axis count is the number of signals the view shows with that axis
 *    checked (so, all axes checked, each axis reads the displayed total).
 *  - An exclusion count is the number of signals that exclusion hides (or
 *    would hide once checked): excluding its own criterion keeps it from
 *    always reading 0 once checked.
 */
export function facetedVivierFiltreCounts(
  cube: VivierFiltreCube,
  axes: VivierFiltreAxes,
  exclusions: VivierBExclusions,
): VivierFiltreCounts {
  const counts: VivierFiltreCounts = { z: 0, r: 0, p: 0, piia: 0, derog: 0 };
  for (const [key, count] of Object.entries(cube)) {
    const flags = {
      z: key[0] === "1", r: key[1] === "1", p: key[2] === "1",
      piia: key[3] === "1", derog: key[4] === "1",
    };
    const passesExcept = (except: Criterion): boolean =>
      (except === "z" || !axes.z || flags.z)
      && (except === "r" || !axes.r || flags.r)
      && (except === "p" || !axes.p || flags.p)
      && (except === "piia" || !exclusions.piiaSansProjetResidentiel || !flags.piia)
      && (except === "derog" || !exclusions.derogationsMineures || !flags.derog);
    for (const criterion of ["z", "r", "p", "piia", "derog"] as const) {
      if (flags[criterion] && passesExcept(criterion)) counts[criterion] += count;
    }
  }
  return counts;
}

/** Signals the view shows for this Filtre state (every criterion applied). */
export function displayedVivierFiltreCount(
  cube: VivierFiltreCube,
  axes: VivierFiltreAxes,
  exclusions: VivierBExclusions,
): number {
  let total = 0;
  for (const [key, count] of Object.entries(cube)) {
    if (axes.z && key[0] !== "1") continue;
    if (axes.r && key[1] !== "1") continue;
    if (axes.p && key[2] !== "1") continue;
    if (exclusions.piiaSansProjetResidentiel && key[3] === "1") continue;
    if (exclusions.derogationsMineures && key[4] === "1") continue;
    total += count;
  }
  return total;
}
