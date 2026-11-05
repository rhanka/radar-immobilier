import { isReaderOperation } from "./reader-operations.js";

/**
 * Lot J1.3a: typed reader journal.
 *
 * One line per reader outcome (opening gesture, consent decision, H5 call)
 * so an empty view (« 0 signaux · 0 villes ») can be told apart from a
 * refusal, a missing consent or a ledger outage. The record is closed by
 * construction: a typed code, an HTTP status, an operation NAME from the
 * reader catalogue and the request id the page already shows. It never
 * carries a city, a signal, a query, a basket, a workspace or a reader
 * identifier — values that do not match the closed shapes below are
 * replaced, never copied.
 */
export type ReaderEventSurface = "opening" | "h5";

export interface ReaderEvent {
  readonly surface: ReaderEventSurface;
  readonly code: string;
  readonly status: number;
  /** H5 operation name from the closed reader catalogue only. */
  readonly op?: string;
  readonly requestId?: string;
  /** Number of returned rows on a successful H5 read (no row content). */
  readonly count?: number;
}

export type ReaderEventSink = (event: ReaderEvent) => void;

/**
 * Closed list of codes the journal may carry. Anything else, including a
 * well-formed string echoed from a response body, becomes `unclassified`.
 */
export const READER_EVENT_CODES: ReadonlySet<string> = new Set([
  // H5 success.
  "ok",
  // Opening and consent flow (control origin).
  "consent_screen", "consent_screen_revoked", "consent_reused", "consent_recorded",
  "consent_refused", "consent_decision_invalid", "consent_ledger_unavailable", "consent_ledger_write_failed",
  // Gate B and reader envelope codes.
  "basket_consent_required", "basket_consent_declined",
  "invalid_query", "invalid_cursor", "incompatible_continuation", "workspace_required", "workspace_ambiguous",
  "workspace_missing", "unauthenticated", "session_expired", "account_not_approved", "workspace_not_authorized",
  "capability_required", "delegated_scope_refused", "target_not_found", "snapshot_changed", "cursor_expired",
  "reveal_required", "request_too_large", "request_uri_too_long", "internal_error", "upstream_bad_payload",
  "signal_capability_unavailable", "lot_cutover_closed", "personal_history_unresolved", "transport_unavailable",
  "catalog_unavailable", "projection_revision_unstable", "projection_payload_too_large",
  // Legacy string errors of the reader content host.
  "capability_unavailable", "collection_not_found", "forbidden", "forbidden_origin", "geo_bbox_required",
  "geo_governed_listing_unreachable", "geo_governed_not_served", "geo_proxy_error", "invalid_authority",
  "invalid_params", "method_not_allowed", "not_found", "range_not_satisfiable", "unknown_operation",
  // Status-derived fallbacks.
  "http_400", "http_401", "http_403", "http_404", "http_405", "http_409", "http_413", "http_414",
  "http_429", "http_500", "http_502", "http_503", "http_504",
]);
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reduce any candidate event to the closed journal shape. */
export function sanitizeReaderEvent(event: ReaderEvent): ReaderEvent {
  const code = READER_EVENT_CODES.has(event.code) ? event.code : "unclassified";
  const status = Number.isInteger(event.status) && event.status >= 100 && event.status <= 599 ? event.status : 0;
  const out: { -readonly [K in keyof ReaderEvent]: ReaderEvent[K] } = { surface: event.surface, code, status };
  if (event.op !== undefined) out.op = isReaderOperation(event.op) ? event.op : "unknown_operation";
  if (event.requestId !== undefined && REQUEST_ID_RE.test(event.requestId)) out.requestId = event.requestId.toLowerCase();
  if (event.count !== undefined && Number.isInteger(event.count) && event.count >= 0) out.count = event.count;
  return out;
}

/** Wrap a sink so every emitted line is sanitized and a sink failure never breaks a response. */
export function readerEventEmitter(sink: ReaderEventSink | undefined): (event: ReaderEvent) => void {
  if (!sink) return () => undefined;
  return (event) => {
    try { sink(sanitizeReaderEvent(event)); } catch { /* journal is best effort */ }
  };
}

/** Production sink: one JSON line on stdout, tagged for log queries. */
export const consoleReaderEventSink: ReaderEventSink = (event) => {
  console.info(JSON.stringify({ event: "reader_event", ...event }));
};

/**
 * Typed failure code of a reader JSON body (envelope or legacy string),
 * restricted to READER_EVENT_CODES; else the status-derived code when
 * listed, else `unclassified`.
 */
export function readerFailureCode(body: unknown, status: number): string {
  let candidate: string | undefined;
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
      candidate = (error as { code: string }).code;
    } else if (typeof error === "string") candidate = error;
  }
  if (candidate !== undefined && READER_EVENT_CODES.has(candidate)) return candidate;
  const fallback = `http_${status}`;
  return candidate === undefined && READER_EVENT_CODES.has(fallback) ? fallback : "unclassified";
}
