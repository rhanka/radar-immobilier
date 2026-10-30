/**
 * Client for GET /api/v1/workspaces/:ws/signal-facets/by-city (6H scoped
 * aggregate): Signal + DesignationEvent counts per city from graph_nodes,
 * counted under the explicit workspace visibility (an effectively discarded
 * target is not counted unless `showDiscarded=1`).
 */

import type { DocumentDateBasis, VivierV2Counts } from "@radar/domain";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchJsonWithTimeout,
  readJsonErrorCode,
} from "$lib/net/fetch-with-timeout.js";
import {
  GraphSignalsHttpError,
  scopedSignalFacetsPath,
  type SignalScope,
} from "./graph-signal-detail-client.js";

export interface GraphSignalCityItem {
  citySlug: string;
  signalCount: number;
  /**
   * Comptes du vivier v2 (vue B), calculés par le serveur dans la MÊME passe
   * que `subsetCounts` (`aggregateGraphSignalProjectionRows`), sur la même
   * donnée. Invariant : total = qualified + residentialUnknown + Σ exclusions.
   * Absent des réponses d'un serveur antérieur au contrat vivier v2.
   */
  vivierV2Counts?: VivierV2Counts;
  /**
   * Exact intersection counts for each subset of {z, m, p, r} flags.
   * Keys: "", "z", "m", "p", "r", "z|m", … up to "z|m|p|r" (16 keys).
   * Value = nb signals satisfying ALL flags in the key.
   *   z = isZonage  (DesignationEvent always; Signal if category ∈ ZONAGE_CATEGORIES)
   *   m = isMulti4  (nb_unites_max ≥ 4 OR intensite = 'haute')
   *   p = isPrecoce (etape ∈ {avis_motion, projet_reglement})
   *   r = isResidentielPertinent (NOT explicitly non-residential; keeps
   *       residential + indeterminate, drops industriel/commercial/camping/enviro)
   */
  subsetCounts: Record<string, number>;
}

export interface GraphSignalsByCityResponse {
  ok: boolean;
  totalCount: number;
  cities: GraphSignalCityItem[];
}

/**
 * Fenêtre date OPTIONNELLE (#4) : bornes ISO (YYYY-MM-DD) passées au serveur
 * date-aware. Le serveur filtre subsetCounts/vivierV2Counts sur cette fenêtre
 * (mêmes clés de date que la lentille signaux). ABSENTES = comportement
 * all-time (rétro-compatible). « Illimité » = ne passer aucune borne.
 */
export interface GraphSignalsByCityOptions {
  dateFrom?: string | null;
  dateTo?: string | null;
  dateBasis?: DocumentDateBasis;
  excludePiia?: boolean;
  excludeDerogations?: boolean;
  /**
   * Reveal discarded signals: `showDiscarded=1` recalculates counters on
   * the complete B(F) population. Hidden by default; forward unchanged.
   */
  showDiscarded?: boolean;
  /** External abort (latest-wins guard). Distinct from the inner timeout. */
  signal?: AbortSignal;
  /** Max wait before the read fails instead of hanging. */
  timeoutMs?: number;
}

export async function fetchGraphSignalsByCity(
  scope: SignalScope,
  opts: GraphSignalsByCityOptions = {},
): Promise<GraphSignalsByCityResponse> {
  const params = new URLSearchParams();
  if (opts.dateFrom) params.set("dateFrom", opts.dateFrom);
  if (opts.dateTo) params.set("dateTo", opts.dateTo);
  if (opts.dateBasis === "scrap") params.set("dateBasis", "scrap");
  if (opts.excludePiia) params.set("excludePiia", "1");
  if (opts.excludeDerogations) params.set("excludeDerogations", "1");
  if (opts.showDiscarded === true) params.set("showDiscarded", "1");
  const qs = params.toString();
  // Bounded headers AND body: a stalled body still fails with
  // `RequestTimeoutError` instead of blocking the caller forever.
  const res = await fetchJsonWithTimeout<GraphSignalsByCityResponse>(
    scopedSignalFacetsPath(scope, `by-city${qs ? `?${qs}` : ""}`),
    {
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    },
  );
  if (!res.ok) {
    throw new GraphSignalsHttpError(
      `by-city: ${res.status}`,
      res.status,
      readJsonErrorCode(res.json),
    );
  }
  if (res.json === null) {
    throw new GraphSignalsHttpError("by-city: empty JSON body", res.status, null);
  }
  return res.json;
}
