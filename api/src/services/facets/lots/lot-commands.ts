/**
 * 6J lot command DTOs and digest.
 *
 * The route determines personal or workspace scope; the server derives the
 * actor and the personal owner. Client-supplied actor, owner, tenant, or
 * arbitrary scope fields are rejected. The digest covers the contract
 * version, route family, native target, workspace, mode, expected heads,
 * displayed version, reason, normalized deselections, the action payload,
 * and every batch item under a documented deterministic normalization.
 */
import { digest } from "../target.js";
import type { DisplayedLotVersion, LotMode, LotTarget } from "./lot-target.js";

export const LOT_FACETS_CONTRACT_VERSION = "lot-facets-v1";

export const LOT_IMPORT_PROFILE = "lot-import-v1";
export const LOT_IMPORT_UNKNOWN_REASON = "legacy-unknown";

export type LotScope = "personal" | "workspace";

export type LotMutation =
  | { action: "select"; basket_id: string }
  | { action: "deselect"; basket_id: string }
  | { action: "discard"; reasonCode: string; deselect?: Array<{ basket_id: string; expected_head_id: string | null }> | undefined }
  | { action: "restore" }
  | { action: "set_pipeline"; status: "sollicite" | "lettre_envoyee" }
  | { action: "clear_pipeline" }
  | { action: "set_market"; status: "en_vente"; asking_price: string | null; listing_url: string | null }
  | { action: "clear_market" };

export interface LotCommandItem {
  target: LotTarget;
  displayed_version: DisplayedLotVersion;
  expected_head_id: string | null;
  mutation: LotMutation;
}

export interface LotCommand extends LotCommandItem {
  contract_version: "lot-facets-v1";
  command_key: string;
  mode: LotMode;
}

export interface LotBatchCommand {
  contract_version: "lot-facets-v1";
  command_key: string;
  mode: LotMode;
  items: LotCommandItem[];
}

export interface LotBatchItemResult {
  target: LotTarget;
  event: import("./lot-response.js").LotEventSnapshot | null;
  appended: boolean;
}

export interface LotBatchResult {
  targets: number;
  changed: number;
  unchanged: number;
  eventsAppended: number;
  items: LotBatchItemResult[];
}

function normalizeMutation(mutation: LotMutation): unknown {
  switch (mutation.action) {
    case "select":
    case "deselect":
      return { action: mutation.action, basket_id: mutation.basket_id };
    case "discard":
      return {
        action: "discard",
        reasonCode: mutation.reasonCode,
        deselect: [...(mutation.deselect ?? [])]
          .map((entry) => ({ basket_id: entry.basket_id, expected_head_id: entry.expected_head_id }))
          .sort((left, right) => (left.basket_id < right.basket_id ? -1 : 1)),
      };
    case "restore":
      return { action: "restore" };
    case "set_pipeline":
      return { action: "set_pipeline", status: mutation.status };
    case "clear_pipeline":
      return { action: "clear_pipeline" };
    case "set_market":
      return {
        action: "set_market",
        status: "en_vente",
        asking_price: mutation.asking_price,
        listing_url: mutation.listing_url,
      };
    case "clear_market":
      return { action: "clear_market" };
  }
}

function normalizeItem(item: LotCommandItem): unknown {
  return {
    target: item.target,
    displayed_version: item.displayed_version,
    expected_head_id: item.expected_head_id ?? null,
    mutation: normalizeMutation(item.mutation),
  };
}

export function lotCommandDigest(
  scope: LotScope,
  family: "single" | "batch",
  workspaceId: string,
  command: LotCommand | LotBatchCommand,
): string {
  const body = "items" in command
    ? {
      version: LOT_FACETS_CONTRACT_VERSION,
      family,
      scope,
      workspace: workspaceId.toLowerCase(),
      mode: command.mode,
      items: [...command.items].map(normalizeItem).sort((left, right) =>
        JSON.stringify(left) < JSON.stringify(right) ? -1 : 1),
    }
    : {
      version: LOT_FACETS_CONTRACT_VERSION,
      family,
      scope,
      workspace: workspaceId.toLowerCase(),
      mode: command.mode,
      item: normalizeItem(command),
    };
  return digest(body);
}
