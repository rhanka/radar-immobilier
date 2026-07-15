import type { GraphSignalNode } from "./graph-signal-detail-client.js";

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

function hasCompatibleMembership(node: GraphSignalNode): boolean {
  const membership = node.legacySubset;
  return membership?.version === "legacy-zmp-v1" &&
    membership.signalId === node.id &&
    typeof membership.flags.z === "boolean" &&
    typeof membership.flags.m === "boolean" &&
    typeof membership.flags.p === "boolean";
}

/** Exact server-classified IDs; incompatible payloads never get a fallback. */
export function projectNodesForVivierMode(
  nodes: GraphSignalNode[],
  mode: VivierViewMode,
): { available: boolean; nodes: GraphSignalNode[] } {
  if (!nodes.every(hasCompatibleMembership)) return { available: false, nodes: [] };
  return {
    available: true,
    nodes: nodes.filter((node) => {
      const flags = node.legacySubset!.flags;
      return mode === "a" ? flags.z && flags.m && flags.p : flags.z && flags.p;
    }),
  };
}
