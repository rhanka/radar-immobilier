/**
 * signals-live — derive the REAL T1 signal feed from the ontology API.
 *
 * The T1 feed used to be seeded from `demoSignalsT1`, which mixed 3 real pilot
 * signals with 3 synthetic `mode:"simulation"` fixtures. This module replaces
 * that with the real pipeline: it reads aggregate DesignationEvent counts
 * (`GET /api/signals/by-city`), then fetches the per-city change details
 * (`GET /api/signals/:city/detail`) for every city that actually has events,
 * and maps each DesignationEvent to a `SignalT` (always `mode:"real"`).
 *
 * Anti-invention: a city with `designationEventCount === 0` is skipped (no
 * detail fetch, no fabricated signal). When no city has events the feed is
 * legitimately empty — that is the honest state, not an error.
 */

import {
  SIGNAL_TYPE_VALUES,
  type ConfidenceT,
  type SignalT,
} from "@radar/domain";

import type {
  SignalCityItem,
  SignalsByCityResponse,
} from "./signals-by-city-client.js";
import type {
  DesignationEventDetail,
  SignalDetailResponse,
} from "./signal-detail-client.js";

/** Minimal client surface this module depends on (injected in tests). */
export interface LiveSignalsClients {
  fetchSignalsByCity: () => Promise<SignalsByCityResponse>;
  fetchSignalDetail: (citySlug: string) => Promise<SignalDetailResponse>;
}

/**
 * Map one real DesignationEvent to a T1 `SignalT`.
 *
 * A DesignationEvent is a confirmed zonage change (avis de motion / règlement),
 * so it maps to the highest-value VISION type, `residential-rezoning` (10/10).
 *
 * Confidence is derived from how well-structured the evidence is:
 *   - `high`   the event carries at least one règlement number AND one zone ref,
 *   - `medium` it carries one of the two,
 *   - `low`    it carries neither (label-only — kept honest, still real).
 */
export function mapDesignationEventToSignal(
  citySlug: string,
  event: DesignationEventDetail,
  index: number,
): SignalT {
  const hasReglement = event.reglementNumbers.length > 0;
  const hasZone = event.zoneRefs.length > 0;
  const confidence: ConfidenceT =
    hasReglement && hasZone ? "high" : hasReglement || hasZone ? "medium" : "low";

  const signal: SignalT = {
    id: `evt-${citySlug}-${index}`,
    type: "residential-rezoning",
    value: SIGNAL_TYPE_VALUES["residential-rezoning"],
    confidence,
    status: "nouveau",
    sourceRefs: event.sourceRef ? [event.sourceRef] : [],
    detectedAt: event.dateObserved,
    mode: "real",
  };
  if (hasReglement) signal.bylaw = event.reglementNumbers.join(", ");
  if (hasZone) signal.zone = event.zoneRefs.join(", ");
  return signal;
}

/** Cities with at least one real DesignationEvent (count > 0). */
export function citiesWithEvents(
  items: readonly SignalCityItem[],
): SignalCityItem[] {
  return items.filter((i) => i.designationEventCount > 0);
}

/**
 * Load the real T1 signal feed: aggregate counts → per-city details → signals.
 * Returns signals sorted newest-first by `detectedAt`. Never fabricates: an
 * empty array is the honest result when no city has events.
 */
export async function loadLiveSignals(
  clients: LiveSignalsClients,
): Promise<SignalT[]> {
  const byCity = await clients.fetchSignalsByCity();
  const cities = citiesWithEvents(byCity.items);

  const perCity = await Promise.all(
    cities.map((c) => clients.fetchSignalDetail(c.citySlug)),
  );

  const signals: SignalT[] = [];
  for (const detail of perCity) {
    detail.events.forEach((event, i) => {
      signals.push(mapDesignationEventToSignal(detail.citySlug, event, i));
    });
  }

  signals.sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : a.detectedAt > b.detectedAt ? -1 : 0));
  return signals;
}
