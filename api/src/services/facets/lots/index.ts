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

/** Atomic transitions. */
export {
  appendLotTransition,
  type LotAppendOutcome,
  type LotImportProvenance,
} from "./lot-apply.js";
export {
  lotStreamKey,
  lotTargetLock,
  resolveLotStream,
  type LotFacet,
  type LotStreamRef,
  type LotStreamScope,
} from "./lot-streams.js";

/** Public event snapshots. */
export {
  lotEventResponse,
  type LotEventSnapshot,
  type LotEventSource,
} from "./lot-response.js";

/** Shape validation and D4 authorization shared by writers. */
export {
  authorizeLotMutation,
  validateLotMutationShape,
} from "./lot-authorize.js";

/** Single commands and the atomic batch. */
export { writeLotFacet, type LotTx, type LotWriteResult } from "./lot-writer.js";
export { writeLotBatch } from "./lot-batch.js";

/** Authorized reads and paginated history. */
export {
  isEffectivelyDiscarded,
  readLotState,
  type LotArchiveHead,
  type LotArchiveState,
  type LotReadState,
  type LotSelectionHead,
} from "./lot-reader.js";

/** Collection projection. */
export { readLotCity, type LotCityHead } from "./lot-city.js";
export {
  readLotHistory,
  readLotSourceHistory,
  type LotHistoryPage,
  type LotSourceHistoryPage,
} from "./lot-history.js";

/** Import run ledger. */
export {
  recordImportReceipt,
  replayRecordedReceipt,
  type LotImportCounts,
  type LotImportInput,
  type LotImportReceipt,
} from "./lot-import-runs.js";

/** Synthetic importer and preserved evidence. */
export {
  LOT_IMPORTER_VERSION,
  runLotImport,
} from "./lot-importer.js";
export {
  LOT_6J_AA,
  LOT_6J_BB,
  lot6jMarks,
  lot6jVersions,
  qualifiedLotReport,
  unqualifiedLotReport,
} from "./lot-import-input.js";

/** Terminal-head projection. */
export {
  isProjectableHead,
  projectTerminalHeads,
  type ProjectionInput,
} from "./lot-project.js";
