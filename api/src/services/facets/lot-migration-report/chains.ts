/**
 * Supersession topology helpers: chain components and cycle detection.
 *
 * Chains are connected components over `supersedes`/`supersededBy` links
 * whose peer exists in the snapshot; dangling links are reported as
 * `chain-broken`, never silently followed. Timestamps never decide
 * membership: only recorded links do.
 */

import { compareText } from "./digest.js";
import type { SourceMark } from "./types.js";

/** Union-find over source ids, processed in sorted order for determinism. */
export function buildChains(marks: readonly SourceMark[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const link = parent.get(id) ?? id;
    if (link === id) return id;
    const root = find(link);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft === rootRight) return;
    const winner = compareText(rootLeft, rootRight) <= 0 ? rootLeft : rootRight;
    parent.set(rootLeft, winner);
    parent.set(rootRight, winner);
  };
  const byId = new Map(marks.map((mark) => [mark.id, mark]));
  for (const mark of [...marks].sort((a, b) => compareText(a.id, b.id))) {
    if (mark.supersedes !== null && byId.has(mark.supersedes)) {
      union(mark.id, mark.supersedes);
    }
    if (mark.supersededBy !== null && byId.has(mark.supersededBy)) {
      union(mark.id, mark.supersededBy);
    }
  }
  const chainId = new Map<string, string>();
  for (const mark of marks) chainId.set(mark.id, find(mark.id));
  return chainId;
}

/** Detect loops in either recorded direction, visiting each edge once. */
export function findCyclicRows(byId: Map<string, SourceMark>): Set<string> {
  const cyclic = new Set<string>();
  for (const direction of ["supersedes", "supersededBy"] as const) {
    const visited = new Set<string>();
    for (const start of byId.keys()) {
      const trail: string[] = [];
      const positions = new Map<string, number>();
      let current: string | null = start;
      while (current !== null && byId.has(current) && !visited.has(current)) {
        const position = positions.get(current);
        if (position !== undefined) {
          for (const member of trail.slice(position)) cyclic.add(member);
          break;
        }
        positions.set(current, trail.length);
        trail.push(current);
        current = byId.get(current)?.[direction] ?? null;
      }
      for (const member of trail) visited.add(member);
    }
  }
  return cyclic;
}

/** Missing, nonreciprocal or cross-dimension links invalidate the whole chain. */
export function findBrokenChains(
  byId: Map<string, SourceMark>, chainId: Map<string, string>,
): Set<string> {
  const broken = new Set<string>();
  for (const mark of byId.values()) {
    for (const [link, inverse] of [
      ["supersedes", "supersededBy"], ["supersededBy", "supersedes"],
    ] as const) {
      const id = mark[link];
      if (id === null) continue;
      const peer = byId.get(id);
      if (!peer || peer[inverse] !== mark.id || peer.dimension !== mark.dimension) {
        broken.add(chainId.get(mark.id) ?? mark.id);
      }
    }
  }
  return broken;
}
