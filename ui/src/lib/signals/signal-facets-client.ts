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
export function facetStateKey(target: Pick<FacetTarget, "type" | "id">): string {
  return `${target.type}/${target.id}`;
}

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
