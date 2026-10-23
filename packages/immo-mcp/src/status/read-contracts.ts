/**
 * S0 read contracts for `get_facet_context`, `get_signal_facets` and
 * `get_lot_facets` (design v3 section 2).
 *
 * Pure validators only. No handler, no registration, no transport.
 */
import { GetSignalFacetsInputSchema, GetLotFacetsInputSchema } from "./read-schemas.js";

export const STATUS_READ_PAGE_MAX = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
const CITY_RE = /^[a-z0-9-]+$/;

export type LotMode = "real" | "simulation";
export type TargetReadiness = "ready" | "missing_state" | "source_unavailable" | "projection_unavailable";

export interface FacetContextInput {
  readonly workspaceId?: string | undefined;
}

export interface SignalFacetsInput {
  readonly workspaceId: string;
  readonly city: string;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly reveal?: boolean | undefined;
}

export interface LotFacetsInput {
  readonly workspaceId: string;
  readonly mode: LotMode;
  readonly city: string;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

export type ReadContractError =
  | "workspace_missing"
  | "workspace_malformed"
  | "city_missing"
  | "city_malformed"
  | "mode_missing"
  | "page_overflow"
  | "truncation_without_continuation"
  | "incompatible_continuation"
  | "heads_leaked_in_context";

export function validateSignalFacetsInput(input: SignalFacetsInput): ReadContractError | null {
  if (!input.workspaceId) return "workspace_missing";
  if (!UUID_RE.test(input.workspaceId)) return "workspace_malformed";
  if (!input.city) return "city_missing";
  if (!CITY_RE.test(input.city) || input.city.length > 128) return "city_malformed";
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > STATUS_READ_PAGE_MAX)) {
    return "page_overflow";
  }
  return GetSignalFacetsInputSchema.safeParse(input).success ? null : "incompatible_continuation";
}

export function validateLotFacetsInput(input: LotFacetsInput): ReadContractError | null {
  if (!input.workspaceId) return "workspace_missing";
  if (!UUID_RE.test(input.workspaceId)) return "workspace_malformed";
  if (input.mode !== "real" && input.mode !== "simulation") return "mode_missing";
  if (!input.city) return "city_missing";
  if (!CITY_RE.test(input.city) || input.city.length > 128) return "city_malformed";
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > STATUS_READ_PAGE_MAX)) {
    return "page_overflow";
  }
  return GetLotFacetsInputSchema.safeParse(input).success ? null : "incompatible_continuation";
}

/** A page that is cut short must carry an explicit continuation. */
export function validatePageContinuation(
  itemCount: number,
  truncated: boolean,
  nextCursor: string | null | undefined,
): ReadContractError | null {
  if (!Number.isInteger(itemCount) || itemCount < 0 || itemCount > STATUS_READ_PAGE_MAX) return "page_overflow";
  if (truncated && !nextCursor) return "truncation_without_continuation";
  return null;
}

/** Continuation tokens stay bound to their authorized query context. */
export function validateContinuationBinding(expected: string, received: string | undefined): ReadContractError | null {
  if (received === undefined) return null;
  return received === expected ? null : "incompatible_continuation";
}

/** Context answers carry availability metadata only, never heads/history/receipts. */
export function validateContextOutputClean(output: Record<string, unknown>): ReadContractError | null {
  for (const [key, value] of Object.entries(output)) {
    if (["heads", "history", "receipt", "receipts"].includes(key)) return "heads_leaked_in_context";
    if (value && typeof value === "object"
      && validateContextOutputClean(value as Record<string, unknown>)) return "heads_leaked_in_context";
  }
  return null;
}

/** Effective hiding is personal hiding OR common hiding. */
export function effectiveHidden(personalHidden: boolean, commonHidden: boolean): boolean {
  return personalHidden || commonHidden;
}

export function isDisplayedFingerprint(value: unknown): boolean {
  return typeof value === "string" && SHA256_RE.test(value);
}
