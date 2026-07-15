import type {
  GraphSignalNode,
  LegacyZmpProjection,
} from "./graph-signal-detail-client.js";
import {
  parseKey,
  type SelectionBucketState,
  type SelectionKey,
} from "$lib/maps/selection-bucket.js";
import type { GeoRoute } from "$lib/router/geo-route.js";

export const A_SUBSET_KEY = "z|m|p" as const;
export const TRANSITION_SUBSET_KEY = "z|p" as const;
export type VivierViewMode = "a" | "transition";

/** Only the explicit transition key opts out of immutable A. */
export function modeFromSubsetKey(raw: string | null | undefined): VivierViewMode {
  const parts = raw?.split("|") ?? [];
  return parts.length === 2 && parts.includes("z") && parts.includes("p")
    ? "transition"
    : "a";
}

export function subsetKeyForMode(mode: VivierViewMode): string {
  return mode === "transition" ? TRANSITION_SUBSET_KEY : A_SUBSET_KEY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCompatibleMembership(node: GraphSignalNode): boolean {
  const membership = node.legacySubset;
  if (!isRecord(membership) || !isRecord(membership.flags)) return false;
  return membership.version === "legacy-zmp-v1" &&
    membership.signalId === node.id &&
    typeof membership.flags.z === "boolean" &&
    typeof membership.flags.m === "boolean" &&
    typeof membership.flags.p === "boolean";
}

function parseProjection(value: unknown): LegacyZmpProjection | null {
  if (!isRecord(value) || value.version !== "legacy-zmp-v1") return null;
  const parseMode = (mode: unknown): { count: number; signalIds: string[] } | null => {
    if (!isRecord(mode) || !Number.isInteger(mode.count) || (mode.count as number) < 0) return null;
    if (!Array.isArray(mode.signalIds) || !mode.signalIds.every((id) => typeof id === "string")) return null;
    const signalIds = mode.signalIds as string[];
    if (new Set(signalIds).size !== signalIds.length || mode.count !== signalIds.length) return null;
    return { count: mode.count as number, signalIds };
  };
  const a = parseMode(value.a);
  const transition = parseMode(value.transition);
  return a && transition ? { version: "legacy-zmp-v1", a, transition } : null;
}

/** Exact server-classified IDs; incompatible payloads never get a fallback. */
export function projectNodesForVivierMode(
  nodes: GraphSignalNode[],
  authority: unknown,
  mode: VivierViewMode,
): { available: boolean; count: number | null; nodes: GraphSignalNode[] } {
  const projection = parseProjection(authority);
  if (!projection || !nodes.every(hasCompatibleMembership)) {
    return { available: false, count: null, nodes: [] };
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const expected = nodes
    .filter((node) => {
      const flags = node.legacySubset!.flags;
      return mode === "a" ? flags.z && flags.m && flags.p : flags.z && flags.p;
    })
    .map((node) => node.id);
  const selected = projection[mode];
  if (expected.length !== selected.count || expected.some((id, index) => id !== selected.signalIds[index])) {
    return { available: false, count: null, nodes: [] };
  }
  const projected = selected.signalIds.map((id) => byId.get(id));
  if (projected.some((node) => node === undefined)) {
    return { available: false, count: null, nodes: [] };
  }
  return { available: true, count: selected.count, nodes: projected as GraphSignalNode[] };
}

export function detailCountForCity(
  entry: { municipality: { slug: string }; subsetCounts: Record<string, number> },
  selectedSlug: string | null,
  authority: unknown,
  mode: VivierViewMode,
): number | null {
  if (entry.municipality.slug !== selectedSlug) {
    return entry.subsetCounts[subsetKeyForMode(mode)] ?? 0;
  }
  return parseProjection(authority)?.[mode].count ?? null;
}

export function routeSubsetKey(route: GeoRoute): string {
  const raw = route.state.filters["subset"]?.join("|") ?? "";
  return subsetKeyForMode(modeFromSubsetKey(raw));
}

export function vivierRouteKey(route: GeoRoute): string {
  const mode = modeFromSubsetKey(routeSubsetKey(route));
  if (route.level === "region") return `region:${route.region}:${route.state.mode}:${mode}`;
  if (route.level === "city") return `city:${route.citySlug}:${route.state.mode}:${mode}`;
  return `zone:${route.citySlug}:${route.zoneKey}:${route.state.mode}:${mode}`;
}

function keepSelectionKey(key: SelectionKey, allowedIds: ReadonlySet<string>): boolean {
  const parsed = parseKey(key);
  return parsed?.kind !== "signal" || allowedIds.has(parsed.id);
}

export function reconcileVivierSelection(
  state: SelectionBucketState,
  allowedIds: ReadonlySet<string>,
): SelectionBucketState {
  const selectedKeys = new Set([...state.selectedKeys].filter((key) => keepSelectionKey(key, allowedIds)));
  const expandedKeys = new Set([...state.expandedKeys].filter((key) => keepSelectionKey(key, allowedIds)));
  const focusedKey = state.focusedKey && keepSelectionKey(state.focusedKey, allowedIds) ? state.focusedKey : null;
  const hoveredKey = state.hoveredKey && keepSelectionKey(state.hoveredKey, allowedIds) ? state.hoveredKey : null;
  return { selectedKeys, expandedKeys, focusedKey, hoveredKey };
}

export function retainProjectedSignalId(
  id: string | null,
  allowedIds: ReadonlySet<string>,
): string | null {
  return id !== null && allowedIds.has(id) ? id : null;
}

export function canOpenProjectedSignal(
  id: string,
  nodes: readonly GraphSignalNode[],
): boolean {
  return nodes.some((node) => node.id === id);
}
