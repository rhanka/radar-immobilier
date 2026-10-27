/**
 * fetch-with-timeout — bounds each network request in time AND links it to an
 * external `AbortSignal` ("anti-race" cancellation on city change).
 *
 * Motivation (map-view bug): map layers (zone fills, lot fills, right-panel
 * signal content) used to start in parallel with NO time bound and NO
 * cancellation. A hanging request left a waiter spinning forever (silent
 * blank), and a late response from the previous city could paint the wrong
 * city. This wrapper provides:
 *
 *  1. TIMEOUT: past `timeoutMs` the request is aborted and the wrapper
 *     throws a `RequestTimeoutError` (explicit layer error state, not an
 *     endless spinner).
 *  2. EXTERNAL CANCELLATION: a caller-provided `signal` (typically the
 *     current city selection's `AbortController`) aborts the request; the
 *     wrapper then RETHROWS the original `AbortError` so the caller tells it
 *     apart from a timeout (a stale response is IGNORED, not displayed).
 *
 * The wrapper never masks a timeout as an abort or vice versa: the
 * distinction drives the client copy ("Unavailable" vs silent ignore).
 *
 * Body bound: `fetchWithTimeout` settles once the headers arrive, so reading
 * the body afterwards (`res.json()`) is unbounded — a stalled body hangs the
 * caller. `fetchJsonWithTimeout` keeps the same timeout and the same external
 * listener armed until the body is fully consumed (success and error paths),
 * and only then releases the timer and the listener.
 */

/** Délai par défaut avant qu'une requête carte soit considérée en échec. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Levée quand une requête dépasse `timeoutMs` (distincte d'un abort externe). */
export class RequestTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;
  constructor(url: string, timeoutMs: number) {
    super(`request timeout after ${timeoutMs}ms: ${url}`);
    this.name = "RequestTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export interface FetchWithTimeoutOptions {
  /** External signal (anti-race cancellation). Combined with the inner timeout. */
  signal?: AbortSignal;
  /** Max wait before failure (ms). Default: `DEFAULT_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Extra `fetch` init (headers, method…). `signal` in it is ignored. */
  init?: Omit<RequestInit, "signal">;
}

/** Parsed JSON body plus status of a bounded JSON read. */
export interface JsonFetchResult<T = unknown> {
  /** HTTP status of the response whose body was consumed. */
  status: number;
  /** `true` for 2xx responses. */
  ok: boolean;
  /**
   * Parsed body. `null` when the response carries no readable JSON body: on
   * the error path this means "no server code" (callers map it to `null`); on
   * the success path callers reject it as an invalid payload.
   */
  json: T | null;
}

/** Server `{error}` body field of an already-parsed JSON body, if any. */
export function readJsonErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" ? error : null;
}

/** `true` when the error is a cancellation (external abort), not a timeout. */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException
      ? err.name === "AbortError"
      : err instanceof Error && err.name === "AbortError"
  );
}

/**
 * Run `use` with an abort signal driven by the timeout and the external
 * signal, and release both in a `finally` once `use` settles. The timeout
 * therefore covers everything `use` awaits — headers AND body.
 */
async function runWithTimeout<T>(
  url: string,
  opts: FetchWithTimeoutOptions,
  use: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const external = opts.signal;
  const controller = new AbortController();

  // An already-aborted external signal short-circuits immediately.
  if (external?.aborted) {
    throw abortErrorFrom(external);
  }

  let timedOut = false;
  const onExternalAbort = () => controller.abort();
  external?.addEventListener("abort", onExternalAbort, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await use(controller.signal);
  } catch (err) {
    // An abort may come from the timeout OR the external signal. Raise the
    // error that reflects the TRUE cause so the caller can route it.
    if (timedOut) throw new RequestTimeoutError(url, timeoutMs);
    if (external?.aborted) throw abortErrorFrom(external);
    throw err;
  } finally {
    clearTimeout(timeoutId);
    external?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Time-bounded `fetch` linked to an external signal.
 *
 * - Inner timeout exceeded → `RequestTimeoutError`.
 * - External signal aborted → the original `AbortError` is rethrown as is.
 * - Otherwise identical to `fetch` (same `Response`, same network errors):
 *   ISO for the fast nominal path. Unchanged public signature: the other
 *   callers keep working while the JSON clients move to `fetchJsonWithTimeout`.
 */
export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<Response> {
  return runWithTimeout(url, opts, (signal) => fetch(url, { ...opts.init, signal }));
}

/**
 * `fetch` whose timeout and external cancellation stay armed until the body
 * is fully consumed — on the success path AND on the error path.
 *
 * A response whose headers arrive but whose body stalls no longer hangs the
 * caller: the still-armed timeout aborts the body read and the wrapper
 * throws `RequestTimeoutError`; an external abort rethrows the `AbortError`.
 * An unreadable error body reads as `json: null` instead of masking the HTTP
 * status; an unreadable success body rethrows (invalid payload).
 */
export async function fetchJsonWithTimeout<T = unknown>(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<JsonFetchResult<T>> {
  return runWithTimeout(url, opts, async (signal) => {
    const res = await fetch(url, { ...opts.init, signal });
    if (res.ok) {
      return { status: res.status, ok: true, json: (await res.json()) as T };
    }
    let json: T | null = null;
    try {
      json = (await res.json()) as T;
    } catch (err) {
      // An aborted body read rethrows so the scope maps the true cause
      // (timeout vs external abort); any other unreadable error body reads
      // as null and keeps the HTTP status meaningful.
      if (isAbortError(err)) throw err;
      json = null;
    }
    return { status: res.status, ok: false, json };
  });
}

function abortErrorFrom(signal: AbortSignal): Error {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason instanceof Error || reason instanceof DOMException) return reason;
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}
