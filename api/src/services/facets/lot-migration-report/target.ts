import type { LotVersionRef, SourceMark } from "./types.js";

export function qualifiedTarget(lot: LotVersionRef | undefined): boolean {
  return lot?.reconStatus === "validated" && lot.canonicalId.length > 0 && lot.citySlug.length > 0;
}

/** Tuple encoding prevents collisions between cities and delimiter-bearing IDs. */
export function nativeTargetFor(mark: SourceMark, lot: LotVersionRef | undefined): string {
  return lot
    ? `canonical:${JSON.stringify([lot.citySlug, lot.canonicalId])}`
    : `denormalized:${JSON.stringify([mark.citySlug, mark.noLot])}`;
}
