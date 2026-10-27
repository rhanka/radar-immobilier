/**
 * 6K guarded lot cutover — module barrel.
 *
 * Contracts in `lot-cutover-types`, classification in
 * `lot-cutover-classify`, status in `lot-cutover-status`, the gate in
 * `lot-cutover-gate`, D5 dispositions in `lot-cutover-dispositions`,
 * the safety probe in `lot-cutover-safety`, and the protected run in
 * `lot-cutover-run`. Import paths through this barrel stay stable.
 */
export * from "./lot-cutover-types.js";
export * from "./lot-cutover-classify.js";
export * from "./lot-cutover-status.js";
export * from "./lot-cutover-gate.js";
export * from "./lot-cutover-dispositions.js";
export * from "./lot-cutover-safety.js";
export * from "./lot-cutover-run.js";
export type { ManifestRow } from "../lot-migration-report/manifest.js";
