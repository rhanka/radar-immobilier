/**
 * S0 successor manifest and `search_signals` successor contract
 * (design v3 sections 5 and 6).
 *
 * The exposed `search_signals` schema stays untouched; this module only
 * freezes the successor shape (optional workspace selector, resolution
 * rules, dedicated endpoint, receiver allowlist entry).
 */

export const BASELINE_TOOL_COUNT = 12;
export const H4_CHECKPOINT_TOOL_COUNT = 16;
export const SUCCESSOR_TOOL_COUNT = 22;

export const SUCCESSOR_SEARCH_ENDPOINT = {
  method: "GET",
  path: "/api/v1/mcp/facets/signals/search",
} as const;

/** Current exposed schema has no workspace field; frozen for compatibility. */
export const CURRENT_SEARCH_SIGNALS_HAS_WORKSPACE = false;

export type SuccessorSearchError =
  | "workspace_missing"
  | "workspace_ambiguous"
  | "workspace_not_authorized"
  | "workspace_malformed";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Successor resolution: authorized set from current membership. Without a
 * selector, resolve only with exactly one authorized workspace. Never
 * substitute another workspace for a refused one.
 */
export function resolveSuccessorSearchWorkspace(
  authorized: readonly string[],
  requested?: string | null | undefined,
): { readonly workspaceId: string } | { readonly error: SuccessorSearchError } {
  for (const id of authorized) {
    if (!UUID_RE.test(id)) return { error: "workspace_malformed" };
  }
  const distinct = [...new Set(authorized.map((id) => id.toLowerCase()))].sort();
  if (requested !== undefined && requested !== null) {
    if (!UUID_RE.test(requested)) return { error: "workspace_malformed" };
    const match = distinct.find((entry) => entry === requested.toLowerCase());
    if (!match) return { error: "workspace_not_authorized" };
    return { workspaceId: match };
  }
  if (distinct.length === 0) return { error: "workspace_missing" };
  if (distinct.length > 1) return { error: "workspace_ambiguous" };
  const only = distinct[0];
  if (only === undefined) return { error: "workspace_missing" };
  return { workspaceId: only };
}

export function validateSuccessorManifest(baseline: number, checkpoint: number, successor: number): boolean {
  return baseline === BASELINE_TOOL_COUNT
    && checkpoint === H4_CHECKPOINT_TOOL_COUNT
    && successor === SUCCESSOR_TOOL_COUNT;
}

/** Arbitrary 404 responses never become an empty success. */
export function isAuthorizedEmptyResult(authorized: boolean, closed: boolean, unavailable: boolean): boolean {
  if (!authorized || closed || unavailable) return false;
  return true;
}
