/** An item that may carry a real/simulation discriminator and/or a per-datum verification. */
export interface MaybeSimulated {
  mode?: "real" | "simulation";
  verification?: "fait" | "hypothese" | "non-disponible" | "simulé";
  [k: string]: unknown;
}

/**
 * Keep only the real-flow items (§2.7 boundary): drops anything whose
 * `mode === "simulation"` OR whose `verification === "simulé"`.
 *
 * Each field is checked only when present; items carrying neither field are kept.
 *
 * Note: local literal unions are used intentionally to keep this helper
 * dependency-light (no @radar/domain zod import required).
 */
export function filterRealMode<T extends MaybeSimulated>(items: readonly T[]): T[] {
  return items.filter((i) => i.mode !== "simulation" && i.verification !== "simulé");
}
