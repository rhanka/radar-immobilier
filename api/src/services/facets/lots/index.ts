/**
 * 6J lot destination: commands and preserved history.
 *
 * Four independent facets (selection, archive, pipeline, market) on one
 * stable lot target, behind a closed activation gate. Operational lot
 * writes stay disabled until 6K; the 6F migration report is the
 * correspondence source for the synthetic importer. Documentary
 * `author_id` values never assign ownership.
 *
 * @packageDocumentation
 */

/** Stable lot identity and displayed source version. */
export {
  LotHeadConflictError,
  LotIdentityError,
  lotFingerprint,
  LotVersionConflictError,
  resolveLotSource,
  toLotTarget,
} from "./lot-target.js";
export type {
  DisplayedLotVersion,
  LotMode,
  LotTarget,
  ResolvedLotSource,
} from "./lot-target.js";

/** Canonical decimal price and public listing-URL validation. */
export {
  assertAskingPrice,
  assertListingUrl,
  assertMarketValue,
  assertPipelineStatus,
  type MarketValue,
  type PipelineStatus,
} from "./lot-values.js";

/** `lot-facets-v1` DTOs and digest. */
export {
  LOT_FACETS_CONTRACT_VERSION,
  LOT_IMPORT_PROFILE,
  LOT_IMPORT_UNKNOWN_REASON,
  lotCommandDigest,
  type LotBatchCommand,
  type LotBatchItemResult,
  type LotBatchResult,
  type LotCommand,
  type LotCommandItem,
  type LotMutation,
  type LotScope,
} from "./lot-commands.js";

/** Distinct D4 rights and explicit grants. */
export {
  assertLotCapability,
  resolveLotRights,
  setLotCapability,
  type LotCapability,
  type LotGrantMutation,
  type LotRights,
} from "./lot-capabilities.js";

/** Closed destination gate. */
export { requireLotDestination, type LotDestination } from "./lot-gate.js";

/** Stream plan model. */
export {
  desiredFor,
  facetForMutation,
  type LotPlan,
  type PlannedStream,
} from "./lot-plan.js";

/** Stream planning. */
export { lotConflictHeads, planLotStreams } from "./lot-transition.js";

