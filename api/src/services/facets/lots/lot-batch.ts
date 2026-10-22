/**
 * 6J atomic lot batch.
 *
 * Between 1 and 500 explicitly identified targets in one workspace, one
 * route scope, and one mode. Every item supplies its own displayed version
 * and expected heads; all items and permissions validate before any
 * mutation. Target and stream locks are acquired in deterministic order;
 * one transaction commits every transition plus the batch receipt, so any
 * authorization, validation, version, or head failure rolls everything
 * back. Missing metadata is an error; no target is silently skipped.
 * Exact retry returns the recorded result; a reused key with different
 * items, expectations, values, or scope conflicts.
 */
import { sql } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  facetCommandContexts,
  facetCommands,
} from "../../../db/schema.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { approvedAccountId } from "../../workspaces/store.js";
import { requireScopedEpoch } from "../scope.js";
import { scopedEpochFor } from "../activation.js";
import { digest, FacetError } from "../target.js";
import {
  LotVersionConflictError,
  resolveLotSource,
} from "./lot-target.js";
import { lotTargetLock } from "./lot-streams.js";
import {
  lotCommandDigest,
  type LotBatchCommand,
  type LotBatchItemResult,
  type LotBatchResult,
  type LotCommand,
  type LotScope,
} from "./lot-commands.js";
import { resolveLotRights } from "./lot-capabilities.js";
import { requireLotDestination } from "./lot-gate.js";
import { authorizeLotMutation, validateLotMutationShape } from "./lot-authorize.js";
import { appendLotTransition } from "./lot-apply.js";
import type { LotPlan } from "./lot-plan.js";
import {
  lotConflictHeads,
  planLotStreams,
} from "./lot-transition.js";
import { lotEventResponse } from "./lot-response.js";

interface PreparedItem {
  key: string;
  itemCommand: LotCommand;
  resolvedFingerprint: string;
  plan: LotPlan;
}

