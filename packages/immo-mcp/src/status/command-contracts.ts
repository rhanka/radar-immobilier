/**
 * S0 command contracts for `command_signal_facet`, `command_lot_facet` and
 * `batch_lot_facet_commands` (design v3 section 3).
 *
 * Frozen wire shapes mirror the existing domain DTOs: camelCase signal
 * bodies, snake_case lot bodies, UUID command keys mapped to
 * `Idempotency-Key` semantics, bounded lot batches. Pure validators only.
 */
import { SignalCommandBodySchemas } from "./signal-command-schemas.js";

export const STATUS_TOOL_NAMES = [
  "get_facet_context",
  "get_signal_facets",
  "command_signal_facet",
  "get_lot_facets",
  "command_lot_facet",
  "batch_lot_facet_commands",
] as const;

export type StatusToolName = (typeof STATUS_TOOL_NAMES)[number];

export const LOT_FACETS_CONTRACT_VERSION = "lot-facets-v1";
export const SIGNAL_FACETS_CONTRACT_VERSION = "signal-facets-v2";
export const LOT_BATCH_MAX = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
const CITY_RE = /^[a-z0-9-]+$/;
const REASON_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

export type SignalAction = "select" | "deselect" | "discard" | "restore";
export type SignalBasket = "pertinent" | "a_surveiller";

export interface SignalCommandBody {
  readonly target: { readonly citySlug: string; readonly type: "Signal" | "DesignationEvent"; readonly id: string };
  readonly expectedHeadId: string | null;
  readonly displayedFingerprint: string;
  readonly basket?: SignalBasket | undefined;
  readonly reasonCode?: string | undefined;
  readonly deselect?: readonly SignalBasket[] | undefined;
  readonly expectedSelectionHeads?: { readonly pertinent?: string | null | undefined; readonly a_surveiller?: string | null | undefined } | undefined;
}

export type LotMutationAction =
  | "select" | "deselect" | "discard" | "restore"
  | "set_pipeline" | "clear_pipeline" | "set_market" | "clear_market";

export type CommandContractError =
  | "command_key_malformed"
  | "workspace_malformed"
  | "target_malformed"
  | "fingerprint_malformed"
  | "head_malformed"
  | "reason_malformed"
  | "expectations_mismatch"
  | "batch_out_of_bounds"
  | "batch_duplicate_target"
  | "batch_mixed_context"
  | "signal_batch_unsupported";

export function validateCommandKey(value: unknown): CommandContractError | null {
  return typeof value === "string" && UUID_RE.test(value) ? null : "command_key_malformed";
}

function validHead(value: unknown): boolean {
  return value === null || (typeof value === "string" && UUID_RE.test(value));
}

export function validateSignalCommand(body: SignalCommandBody, action: SignalAction): CommandContractError | null {
  if (!body?.target || !["Signal", "DesignationEvent"].includes(body.target.type)
    || !CITY_RE.test(body.target.citySlug) || body.target.citySlug.length > 128
    || typeof body.target.id !== "string" || body.target.id.length === 0
    || body.target.id.length > 512) return "target_malformed";
  if (!SHA256_RE.test(body.displayedFingerprint)) return "fingerprint_malformed";
  if (!validHead(body.expectedHeadId)) return "head_malformed";
  if (body.reasonCode !== undefined && (body.reasonCode.length > 128 || !REASON_RE.test(body.reasonCode))) {
    return "reason_malformed";
  }
  if ((action === "select" || action === "deselect") && body.basket === undefined) return "target_malformed";
  if ((action === "select" || action === "deselect" || action === "restore") && body.expectedSelectionHeads !== undefined) {
    return "expectations_mismatch";
  }
  if (action === "discard") {
    const removals = [...new Set(body.deselect ?? [])].sort();
    const expected = body.expectedSelectionHeads ?? {};
    const keys = Object.keys(expected).sort();
    if (removals.length === 0 && keys.length > 0) return "expectations_mismatch";
    if (removals.length > 0) {
      if (keys.length !== removals.length || keys.some((key, index) => key !== removals[index])) {
        return "expectations_mismatch";
      }
      for (const key of keys) {
        if (!validHead((expected as Record<string, unknown>)[key])) return "head_malformed";
      }
    }
  }
  return SignalCommandBodySchemas[action]?.safeParse(body).success ? null : "target_malformed";
}

export interface LotBatchItemKey {
  readonly citySlug: string;
  readonly canonicalId: string;
}

/** 1-500 distinct targets, one workspace/scope/mode; oversized fails before dispatch. */
export function validateLotBatchShape(
  items: readonly LotBatchItemKey[],
  contexts: readonly { readonly workspaceId: string; readonly scope: string; readonly mode: string }[],
): CommandContractError | null {
  if (items.length < 1 || items.length > LOT_BATCH_MAX) return "batch_out_of_bounds";
  const seen = new Set<string>();
  for (const item of items) {
    if (!CITY_RE.test(item.citySlug) || item.canonicalId.length === 0) return "target_malformed";
    const key = JSON.stringify([item.citySlug, item.canonicalId]);
    if (seen.has(key)) return "batch_duplicate_target";
    seen.add(key);
  }
  const first = contexts[0];
  if (first === undefined || !UUID_RE.test(first.workspaceId)) return "workspace_malformed";
  if (contexts.length !== items.length || !["personal", "common"].includes(first.scope)
    || !["real", "simulation"].includes(first.mode)) return "batch_mixed_context";
  for (const entry of contexts) {
    if (entry.workspaceId !== first.workspaceId || entry.scope !== first.scope || entry.mode !== first.mode) {
      return "batch_mixed_context";
    }
  }
  return null;
}

/** There is no general signal batch in this design. */
export function validateNoSignalBatch(tool: string): CommandContractError | null {
  return tool === "batch_signal_facet_commands" ? "signal_batch_unsupported" : null;
}
