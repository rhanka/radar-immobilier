/**
 * Steve-30 opportunity-score convergence chantier (I4).
 *
 * A transparent, rule-based (NO ML) calibration of the radar opportunity
 * score against Steve Chaperon's 30 city notes /10. See features.ts for the
 * feature book and named weights, dataset.ts for the verbatim labels,
 * score.ts for the explicable score, spearman.ts for the rank metric, and
 * convergence.ts for the honest measurement.
 */
export * from "./features.js";
export * from "./dataset.js";
export * from "./score.js";
export * from "./spearman.js";
export * from "./convergence.js";
