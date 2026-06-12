/**
 * signals-live — derive the REAL T1 signal feed from graph_nodes.
 *
 * Replaces the old ontology/project-state pipeline (~9 villes pilote) with a
 * direct read of Signal and DesignationEvent nodes from graph_nodes (graphify
 * pipeline, ~197 villes / 1 141 nœuds).
 *
 * GET /api/graph-signals/by-city → cities with ≥1 signal node
 * GET /api/graph-signals/:city   → Signal+DesignationEvent nodes for one city
 *
 * Anti-invention: a city with signalCount === 0 is skipped (no detail fetch,
 * no fabricated signal). When no city has nodes the feed is legitimately empty.
 */

import {
  SIGNAL_TYPE_VALUES,
  type ConfidenceT,
  type SignalT,
} from "@radar/domain";

import type {
  GraphSignalCityItem,
  GraphSignalsByCityResponse,
} from "./graph-signals-by-city-client.js";
import type {
  GraphSignalNode,
  GraphSignalDetailResponse,
} from "./graph-signal-detail-client.js";

// Re-export types so downstream consumers can import from this module.
export type { GraphSignalCityItem, GraphSignalsByCityResponse };
export type { GraphSignalNode, GraphSignalDetailResponse };

/** Minimal client surface this module depends on (injected in tests). */
export interface LiveSignalsClients {
  fetchGraphSignalsByCity: () => Promise<GraphSignalsByCityResponse>;
  fetchGraphSignalDetail: (citySlug: string) => Promise<GraphSignalDetailResponse>;
}

/**
 * Map one graph_nodes Signal/DesignationEvent row to a T1 `SignalT`.
 *
 * Confidence is derived from available evidence:
 *   - `high`   node carries community_name (rich community context)
 *   - `medium` node carries a sourceRef (evidence file reference)
 *   - `low`    label only (honest — still real, just less structured)
 */
export function mapGraphSignalNodeToSignal(
  node: GraphSignalNode,
  index: number,
): SignalT {
  const props = node.props ?? {};
  const hasCommunity = Boolean(props.community_name);
  const hasSourceRef = Boolean(node.sourceRef);
  const confidence: ConfidenceT = hasCommunity
    ? "high"
    : hasSourceRef
      ? "medium"
      : "low";

  const signal: SignalT = {
    id: `gn-${node.citySlug ?? "x"}-${index}`,
    type: "residential-rezoning",
    value: SIGNAL_TYPE_VALUES["residential-rezoning"],
    confidence,
    status: "nouveau",
    sourceRefs: node.sourceRef ? [node.sourceRef] : [],
    detectedAt: node.createdAt
      ? node.createdAt.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    mode: "real",
  };

  if (props.reglement_number) signal.bylaw = String(props.reglement_number);
  if (props.zone_ref) signal.zone = String(props.zone_ref);

  return signal;
}

/** Cities with at least one signal node (count > 0). */
export function citiesWithSignalNodes(
  items: readonly GraphSignalCityItem[],
): GraphSignalCityItem[] {
  return items.filter((i) => i.signalCount > 0);
}

/**
 * Load the real T1 signal feed from graph_nodes:
 * aggregate counts → per-city nodes → signals.
 *
 * Returns signals sorted newest-first by `detectedAt`. Never fabricates:
 * an empty array is the honest result when no city has signal nodes.
 *
 * Uses Promise.allSettled for per-city fetches so a single city failure
 * does not abort the entire feed.
 */
export async function loadLiveSignals(
  clients: LiveSignalsClients,
): Promise<SignalT[]> {
  const byCity = await clients.fetchGraphSignalsByCity();
  const cities = citiesWithSignalNodes(byCity.cities);

  const settled = await Promise.allSettled(
    cities.map((c) => clients.fetchGraphSignalDetail(c.citySlug)),
  );

  const signals: SignalT[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      result.value.nodes.forEach((node, i) => {
        signals.push(mapGraphSignalNodeToSignal(node, i));
      });
    }
    // Rejected (network error, 404): skip silently — anti-invention.
  }

  signals.sort((a, b) =>
    a.detectedAt < b.detectedAt ? 1 : a.detectedAt > b.detectedAt ? -1 : 0,
  );
  return signals;
}
