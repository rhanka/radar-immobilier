/**
 * D3 report aggregation: pure function from inventory plus graph set.
 *
 * Output holds row counts only: line total, the five exclusive statuses
 * (their sum equals the line total), intended references, ignored tokens,
 * distinct resolved triplets and the classement breakdown. No signal count
 * is derived from rows and no per-row diagnostic is stored.
 */

import { SteveCaptureError } from "../types.js";
import type { WorkbookInventory } from "../types.js";
import { REAL_GRAPH_ADAPTER_VERSION } from "./graph-adapter.js";
import type { IdentifiedGraphSet } from "./graph-set.js";
import type { MunicipalityRef } from "./municipality.js";
import { D3_RULE_VERSION, resolveTriageRow, tripletKey } from "./resolve.js";
import type { D3RowStatus } from "./resolve.js";
import { readTriageRows } from "./triage-rows.js";

export interface D3StatusCounts {
  unavailable: number;
  ambiguous: number;
  fully_resolved: number;
  partially_resolved: number;
  unresolved: number;
}

export interface D3Report {
  ruleVersion: typeof D3_RULE_VERSION;
  adapterVersion: typeof REAL_GRAPH_ADAPTER_VERSION;
  snapshotId: string;
  graphSha256: string;
  lines: number;
  statuses: D3StatusCounts;
  targetedReferences: number;
  ignoredTokens: number;
  resolvedTriplets: number;
  byClassement: Record<string, number>;
}

const EMPTY_COUNTS: D3StatusCounts = {
  unavailable: 0,
  ambiguous: 0,
  fully_resolved: 0,
  partially_resolved: 0,
  unresolved: 0,
};

function bump(counts: D3StatusCounts, status: D3RowStatus): void {
  if (status === "unavailable") counts.unavailable += 1;
  else if (status === "ambiguous") counts.ambiguous += 1;
  else if (status === "fully_resolved") counts.fully_resolved += 1;
  else if (status === "partially_resolved") counts.partially_resolved += 1;
  else counts.unresolved += 1;
}

export function buildD3Report(
  inventory: WorkbookInventory,
  graphSet: IdentifiedGraphSet,
  municipalities?: readonly MunicipalityRef[],
): D3Report {
  const rows = readTriageRows(inventory);
  const statuses: D3StatusCounts = { ...EMPTY_COUNTS };
  let targetedReferences = 0;
  let ignoredTokens = 0;
  const triplets = new Set<string>();
  const classement = new Map<string, number>();
  for (const row of rows) {
    const resolution = resolveTriageRow(row, graphSet, municipalities);
    bump(statuses, resolution.status);
    targetedReferences += resolution.keptTokens;
    ignoredTokens += resolution.ignoredTokens;
    for (const triplet of resolution.resolved) {
      triplets.add(tripletKey(triplet));
    }
    const key = (row.classement.value ?? row.classement.raw ?? "").trim();
    classement.set(key, (classement.get(key) ?? 0) + 1);
  }
  const total =
    statuses.unavailable +
    statuses.ambiguous +
    statuses.fully_resolved +
    statuses.partially_resolved +
    statuses.unresolved;
  if (total !== rows.length) {
    throw new SteveCaptureError(
      `d3 status total ${String(total)} differs from lines ${String(rows.length)}`,
    );
  }
  const byClassement = Object.fromEntries(
    [...classement.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  );
  return {
    ruleVersion: D3_RULE_VERSION,
    adapterVersion: REAL_GRAPH_ADAPTER_VERSION,
    snapshotId: graphSet.snapshotId,
    graphSha256: graphSet.sha256,
    lines: rows.length,
    statuses,
    targetedReferences,
    ignoredTokens,
    resolvedTriplets: triplets.size,
    byClassement,
  };
}
