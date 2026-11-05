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

const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reduce any candidate event to the closed journal shape. */
export function sanitizeReaderEvent(event: ReaderEvent): ReaderEvent {
  const code = CODE_RE.test(event.code) ? event.code : "unclassified";
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

/** Typed failure code of a reader JSON body (envelope or legacy string), else a status-derived code. */
export function readerFailureCode(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
      return (error as { code: string }).code;
    }
    if (typeof error === "string") return error;
  }
  return `http_${status}`;
}
