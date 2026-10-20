/**
 * Client for POST/GET /api/v1/signal-facets (personal signal baskets).
 *
 * Contract mirror of `api/src/routes/signal-facets.ts`:
 * - writes POST /api/v1/signal-facets/{select,deselect,discard,restore} with
 *   strict bodies {target:{citySlug,type,id}, basket?, reasonCode?} plus an
 *   `Idempotency-Key: crypto.randomUUID()` header (one key per intention,
 *   reused when retrying the same intention), same-origin session cookie;
 * - reads GET reason-codes and cities/:city with NO query string (any query
 *   parameter is a server 400);
 * - a write answers {ok, event|null}; failures carry the server error code.
 *
 * The target is the native graph identity (node.citySlug, node.type,
 * node.id). A node without citySlug has no target (no controls). The
 * positional `gn-…` display ids from signals-live are never used here.
 */

import {
  fetchJsonWithTimeout,
  type JsonFetchResult,
  readJsonErrorCode,
  RequestTimeoutError,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "$lib/net/fetch-with-timeout.js";
import type { GraphSignalNode } from "./graph-signal-detail-client.js";

export type FacetBasket = "pertinent" | "a_surveiller";
export type FacetVerdict = "pertinent" | "a_surveiller" | "non_pertinent";
export type FacetAction = "select" | "deselect" | "discard" | "restore";
export type FacetNodeType = "Signal" | "DesignationEvent";

export interface FacetTarget {
  citySlug: string;
  type: FacetNodeType;
  id: string;
}

export interface ReasonCode {
  code: string;
  verdict: string;
}

export interface FacetCommandBody {
  target: FacetTarget;
  basket?: FacetBasket;
  reasonCode?: string;
}

/** One persisted facet head, as served by GET cities/:city. */
export interface FacetHead {
  id: string;
  target: FacetTarget;
  facet: string;
  basket: FacetBasket | null;
  state: string;
  reasonCode: string | null;
  verdict: string | null;
  createdAt: string;
  targetAvailable: boolean;
  changedSinceArchive: boolean | null;
}

/** Aggregated facet state of one signal, driving badges and controls. */
export interface TargetFacetState {
  pertinent: boolean;
  pertinentCode: string | null;
  watching: boolean;
  watchingCode: string | null;
  archived: boolean;
  archiveCode: string | null;
  changedSinceArchive: boolean;
  targetAvailable: boolean;
}

export function emptyTargetFacetState(): TargetFacetState {
  return {
    pertinent: false,
    pertinentCode: null,
    watching: false,
    watchingCode: null,
    archived: false,
    archiveCode: null,
    changedSinceArchive: false,
    targetAvailable: true,
  };
}

/** Map key of one signal target (`<type>/<id>`). */
export function facetStateKey(target: { type: string; id: string }): string {
  return `${target.type}/${target.id}`;
}

/**
 * Read state of one city's facet heads. Unknown heads never imply that
 * the signal is unclassified; only a successful read is authoritative.
 */
export type FacetHeadsStatus = "loading" | "ready" | "error";

/**
 * Native facet target of a graph node, or null when the node carries no
 * usable native identity (missing citySlug, unknown type, empty id): such a
 * node gets no basket controls. The graph id is carried verbatim.
 */
export function buildFacetTarget(node: GraphSignalNode): FacetTarget | null {
  const citySlug = node.citySlug;
  if (!citySlug || citySlug.trim().length === 0) return null;
  if (node.type !== "Signal" && node.type !== "DesignationEvent") return null;
  if (!node.id || node.id.trim().length === 0) return null;
  return { citySlug, type: node.type, id: node.id };
}

/**
 * Reason codes valid for one exact verdict. The match is the full verdict
 * string — never a code prefix (a `P-…` code may carry a `non_pertinent`
 * verdict and vice versa).
 */
export function codesForVerdict(
  codes: readonly ReasonCode[],
  verdict: FacetVerdict,
): ReasonCode[] {
  return codes.filter((row) => row.verdict === verdict);
}

/**
 * Aggregate active heads by signal target. Inactive heads are history, not
 * state. Unknown rows are ignored; a missing target reads as untouched
 * (distinct from restored/cleared, which the server reports explicitly).
 */
export function indexFacetHeads(heads: readonly FacetHead[]): Map<string, TargetFacetState> {
  const byTarget = new Map<string, TargetFacetState>();
  const stateFor = (target: FacetTarget): TargetFacetState => {
    const key = facetStateKey(target);
    const existing = byTarget.get(key);
    if (existing) return existing;
    const fresh = emptyTargetFacetState();
    byTarget.set(key, fresh);
    return fresh;
  };
  for (const head of heads) {
    if (head.state !== "active") continue;
    const state = stateFor(head.target);
    state.targetAvailable = state.targetAvailable && head.targetAvailable !== false;
    if (head.facet === "selection" && head.basket === "pertinent") {
      state.pertinent = true;
      state.pertinentCode = head.reasonCode;
    } else if (head.facet === "selection" && head.basket === "a_surveiller") {
      state.watching = true;
      state.watchingCode = head.reasonCode;
    } else if (head.facet === "archive") {
      state.archived = true;
      state.archiveCode = head.reasonCode;
      state.changedSinceArchive = head.changedSinceArchive === true;
    }
  }
  return byTarget;
}

/** One idempotency key per intention, minted by the caller. */
export function createCommandKey(): string {
  return globalThis.crypto.randomUUID();
}

export interface FacetRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Write failure: `status` is the HTTP status, `code` the server error string
 * ({error} body). A network/timeout failure has status/code null — the write
 * is then unconfirmed and the caller must offer a retry with the same key.
 */
export class SignalFacetError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  constructor(status: number | null, code: string | null, message?: string) {
    super(message ?? `signal-facets: ${status ?? "network-error"}`);
    this.name = "SignalFacetError";
    this.status = status;
    this.code = code;
  }
}

function requestUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

/**
 * POST one facet command. The caller owns the idempotency key: mint one per
 * intention with createCommandKey() and pass the SAME key when retrying that
 * intention. Returns the resulting event (null when the command is a no-op).
 */
export async function postFacetCommand(
  baseUrl: string,
  action: FacetAction,
  body: FacetCommandBody,
  commandKey: string,
  opts: FacetRequestOptions = {},
): Promise<unknown> {
  // Bounded headers AND body: a stalled body still fails with
  // `RequestTimeoutError` instead of blocking the caller forever.
  let res: JsonFetchResult<{ event?: unknown }>;
  try {
    res = await fetchJsonWithTimeout<{ event?: unknown }>(
      requestUrl(baseUrl, `/api/v1/signal-facets/${action}`),
      {
        signal: opts.signal,
        timeoutMs: opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": commandKey,
          },
          // Same-origin session cookie (fetch default): no bearer, no actor.
          body: JSON.stringify(body),
        },
      },
    );
  } catch (err) {
    if (err instanceof RequestTimeoutError) throw new SignalFacetError(null, null);
    throw new SignalFacetError(null, null);
  }
  if (!res.ok) {
    throw new SignalFacetError(res.status, readJsonErrorCode(res.json));
  }
  // An unreadable success body leaves the write unconfirmed: same-key retry.
  if (res.json === null) throw new SignalFacetError(null, null);
  return res.json.event ?? null;
}

export interface ReasonCodesResponse {
  profileId: string;
  codes: ReasonCode[];
}

/** GET reason-codes with no query string (any parameter is a server 400). */
export async function fetchReasonCodes(
  baseUrl: string,
  opts: FacetRequestOptions = {},
): Promise<ReasonCodesResponse> {
  const res = await fetchJsonWithTimeout<{ profileId: string; codes: ReasonCode[] }>(
    requestUrl(baseUrl, "/api/v1/signal-facets/reason-codes"),
    {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    },
  );
  if (!res.ok) throw new SignalFacetError(res.status, readJsonErrorCode(res.json));
  const payload = res.json as { profileId: string; codes: ReasonCode[] } | null;
  if (!payload || !Array.isArray(payload.codes) || !payload.codes.every(
    (row) => row && typeof row.code === "string" && typeof row.verdict === "string",
  )) {
    throw new Error("Invalid reason codes response");
  }
  return { profileId: payload.profileId, codes: payload.codes };
}

export interface CityFacetsResponse {
  heads: FacetHead[];
}

/** GET cities/:city with no query string (any parameter is a server 400). */
export async function fetchCityFacets(
  baseUrl: string,
  city: string,
  opts: FacetRequestOptions = {},
): Promise<CityFacetsResponse> {
  const res = await fetchJsonWithTimeout<{ heads: FacetHead[] }>(
    requestUrl(baseUrl, `/api/v1/signal-facets/cities/${encodeURIComponent(city)}`),
    {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    },
  );
  if (!res.ok) throw new SignalFacetError(res.status, readJsonErrorCode(res.json));
  if (res.json === null) throw new Error("signal-facets: empty JSON body");
  return { heads: res.json.heads };
}

/**
 * French user-facing copy of a write failure, by HTTP status and server
 * error code. A null status (network/timeout) is unconfirmed: same-key retry.
 */
export function isFacetWriteUnconfirmed(error: unknown): boolean {
  return !(error instanceof SignalFacetError) || error.status === null || error.status >= 500;
}

export function facetErrorMessage(error: SignalFacetError): string {
  if (isFacetWriteUnconfirmed(error)) return "Écriture non confirmée — Réessayer.";
  switch (error.status) {
    case 401:
      return "Connexion requise — connectez-vous pour classer ce signal.";
    case 403:
      if (error.code === "browser_session_required") {
        return "Session navigateur requise — rouvrez l'application dans votre navigateur.";
      }
      return "Compte non approuvé ou session navigateur requise.";
    case 404:
      return "Signal introuvable — il a peut-être été retiré du graphe.";
    case 409:
      return "Conflit de clé — rechargez les données puis réessayez.";
    case 422:
      if (error.code === "reason_code_required") return "Code requis — choisissez un code de motif.";
      if (error.code === "invalid_reason_code") return "Code invalide pour ce classement.";
      return "Code requis ou invalide.";
    default:
      return `Écriture refusée (${error.status}).`;
  }
}
