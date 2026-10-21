/**
 * Real-graph reglement adapter for the D3 report (lot 6E, report-only).
 *
 * The lot 5 resolver matches Triage tokens against stored graph shapes where
 * a reglement number may live at `props` or nested under `props.properties`,
 * under `reglement_number`, `cible_reglement_numero` or the camelCase
 * `cibleReglementNumero`, as a scalar or an array. This adapter centralizes
 * that extraction on top of the lot 5 normalization, so the resolver keeps a
 * single matching rule. Report-only: no facet writes and no imports.
 */

import { normalizeReglementKey } from "./graph-set.js";

export const REAL_GRAPH_ADAPTER_VERSION = "real-graph-adapter-v1";

export interface GraphAdapterTokens {
  tokens: string[];
  unsupported: string[];
}

const REGLEMENT_KEYS = [
  "reglement_number",
  "cible_reglement_numero",
  "cibleReglementNumero",
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function collectLeaf(
  location: string,
  value: unknown,
  into: GraphAdapterTokens,
  seen: Set<string>,
): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value.trim().length === 0) return;
    const token = normalizeReglementKey(value);
    if (token.length === 0) return;
    if (!seen.has(token)) {
      seen.add(token);
      into.tokens.push(token);
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      into.unsupported.push(`${location}:non-finite-number`);
      return;
    }
    const token = normalizeReglementKey(String(value));
    if (!seen.has(token)) {
      seen.add(token);
      into.tokens.push(token);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectLeaf(`${location}[${String(index)}]`, item, into, seen);
    });
    return;
  }
  into.unsupported.push(`${location}:${typeof value}`);
}

export function extractGraphNodeTokens(props: unknown): GraphAdapterTokens {
  const result: GraphAdapterTokens = { tokens: [], unsupported: [] };
  const seen = new Set<string>();
  if (props === null || props === undefined) return result;
  if (!isPlainRecord(props)) {
    result.unsupported.push(
      `props:${Array.isArray(props) ? "array" : typeof props}`,
    );
    return result;
  }
  for (const key of REGLEMENT_KEYS) {
    collectLeaf(key, props[key], result, seen);
  }
  const nested = props["properties"];
  if (nested === null || nested === undefined) return sortedResult(result);
  if (!isPlainRecord(nested)) {
    result.unsupported.push(
      `properties:${Array.isArray(nested) ? "array" : typeof nested}`,
    );
    return sortedResult(result);
  }
  for (const key of REGLEMENT_KEYS) {
    collectLeaf(`properties.${key}`, nested[key], result, seen);
  }
  return sortedResult(result);
}

function sortedResult(result: GraphAdapterTokens): GraphAdapterTokens {
  result.tokens.sort();
  result.unsupported.sort();
  return result;
}
