/**
 * D3 row resolver (rule version `d3-report-v1`).
 *
 * Exclusive status, in priority order: a uniquely resolved city whose graph
 * is missing yields `unavailable`; else any city or target conflict yields
 * `ambiguous`; else all intended targets resolved yields `fully_resolved`;
 * else at least one resolved yields `partially_resolved`; else `unresolved`.
 */

import {
  findGraph,
  isGraphNodeType,
  normalizeGraphReglementProp,
  splitReglementTokens,
} from "./graph-set.js";
import type { IdentifiedGraphSet } from "./graph-set.js";
import { resolveMunicipality } from "./municipality.js";
import type { MunicipalityRef } from "./municipality.js";
import type { TriageRow } from "./triage-rows.js";

export const D3_RULE_VERSION = "d3-report-v1";

export type D3RowStatus =
  | "unavailable"
  | "ambiguous"
  | "fully_resolved"
  | "partially_resolved"
  | "unresolved";

export interface D3ResolvedTriplet {
  slug: string;
  type: string;
  id: string;
}

export interface D3RowResolution {
  status: D3RowStatus;
  resolved: D3ResolvedTriplet[];
  keptTokens: number;
  ignoredTokens: number;
}

export function tripletKey(triplet: D3ResolvedTriplet): string {
  return JSON.stringify([triplet.slug, triplet.type, triplet.id]);
}

function candidatesForToken(
  slug: string,
  nodes: readonly { id: string; type: string; props: Record<string, unknown> }[],
  token: string,
): D3ResolvedTriplet[] {
  const out: D3ResolvedTriplet[] = [];
  for (const node of nodes) {
    if (!isGraphNodeType(node.type)) continue;
    const first = normalizeGraphReglementProp(node.props["reglement_number"]);
    const second = normalizeGraphReglementProp(
      node.props["cible_reglement_numero"],
    );
    if (first === token || second === token) {
      out.push({ slug, type: node.type, id: node.id });
    }
  }
  return out;
}

export function resolveTriageRow(
  row: TriageRow,
  graphSet: IdentifiedGraphSet,
  municipalities?: readonly MunicipalityRef[],
): D3RowResolution {
  const cityRaw = row.city.value ?? row.city.raw;
  const mrcRaw = row.mrc.value ?? row.mrc.raw;
  const reglementRaw = row.reglement.value ?? row.reglement.raw;
  const city = resolveMunicipality(cityRaw, mrcRaw, municipalities);
  const tokens = splitReglementTokens(reglementRaw);
  if (city.kind === "conflict") {
    return {
      status: "ambiguous",
      resolved: [],
      keptTokens: tokens.kept.length,
      ignoredTokens: tokens.ignored,
    };
  }
  if (city.kind === "unresolved") {
    return {
      status: "unresolved",
      resolved: [],
      keptTokens: tokens.kept.length,
      ignoredTokens: tokens.ignored,
    };
  }
  const graph = findGraph(graphSet, city.slug);
  if (graph === null) {
    return {
      status: "unavailable",
      resolved: [],
      keptTokens: tokens.kept.length,
      ignoredTokens: tokens.ignored,
    };
  }
  const seen = new Map<string, D3ResolvedTriplet>();
  let resolvedTokens = 0;
  let tokenConflict = false;
  for (const token of tokens.kept) {
    const candidates = candidatesForToken(city.slug, graph.nodes, token);
    if (candidates.length >= 2) tokenConflict = true;
    if (candidates.length === 1) {
      resolvedTokens += 1;
      const only = candidates[0];
      if (only !== undefined) seen.set(tripletKey(only), only);
    }
  }
  if (tokenConflict) {
    return {
      status: "ambiguous",
      resolved: [...seen.values()],
      keptTokens: tokens.kept.length,
      ignoredTokens: tokens.ignored,
    };
  }
  if (tokens.kept.length >= 1 && resolvedTokens === tokens.kept.length) {
    return {
      status: "fully_resolved",
      resolved: [...seen.values()],
      keptTokens: tokens.kept.length,
      ignoredTokens: tokens.ignored,
    };
  }
  if (resolvedTokens >= 1) {
    return {
      status: "partially_resolved",
      resolved: [...seen.values()],
      keptTokens: tokens.kept.length,
      ignoredTokens: tokens.ignored,
    };
  }
  return {
    status: "unresolved",
    resolved: [],
    keptTokens: tokens.kept.length,
    ignoredTokens: tokens.ignored,
  };
}
