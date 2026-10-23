/**
 * S0 frozen rights matrix for status tools (design v3 section 1).
 *
 * Pure contract only: no I/O, no dispatch, no route mounting. The domain
 * keeps its own enforcement; this module freezes the matrix so S1/S2
 * adapters cannot silently widen it.
 *
 * Scope vocabulary here is `personal` / `common`. `common` maps to the
 * domain `workspace` scope. Personal lot favorites, common signal
 * selections and signal prospecting/market states do not exist.
 */

export type StatusScope = "personal" | "common";

export type SignalOperation = "select" | "deselect" | "discard" | "restore";

export type LotOperation =
  | "select"
  | "deselect"
  | "discard"
  | "restore"
  | "set_pipeline"
  | "clear_pipeline"
  | "set_market"
  | "clear_market";

export interface StatusRights {
  readonly select: boolean;
  readonly changePipeline: boolean;
  readonly changeMarket: boolean;
  readonly discardPersonally: boolean;
  readonly moderateArchive: boolean;
}

export type RightsDenial =
  | "workspace_capability_required"
  | "invalid_facet_command"
  | "unknown_operation";

const FORBIDDEN_AUTHORITY_FIELDS = ["actor", "owner", "tenant", "roles", "grants"] as const;

const CONVENIENCE_WORKSPACES = new Set(["radar", "default"]);

/** Caller-supplied authority never confers rights (D4). Returns the offending field or null. */
export function findCallerAuthorityField(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if ((payload as Record<string, unknown>)[field] !== undefined) return field;
  }
  return null;
}

/** Convenience token defaults never authorize status access. */
export function isConvenienceWorkspace(value: string): boolean {
  return CONVENIENCE_WORKSPACES.has(value.trim().toLowerCase());
}

/** Global administration supplies no status right; this guard documents that. */
export function adminGrantsNoStatusRight(isAdmin: boolean): boolean {
  void isAdmin;
  return false;
}

export function signalDenial(
  scope: StatusScope,
  operation: SignalOperation,
  rights: StatusRights,
): RightsDenial | null {
  if (!["personal", "common"].includes(scope)) return "invalid_facet_command";
  if (!["select", "deselect", "discard", "restore"].includes(operation)) return "unknown_operation";
  if (scope === "common" && (operation === "select" || operation === "deselect")) {
    return "invalid_facet_command";
  }
  if (scope === "common" && (operation === "discard" || operation === "restore")) {
    return rights.moderateArchive ? null : "workspace_capability_required";
  }
  if ((operation === "discard" || operation === "restore") && !rights.discardPersonally) {
    return "workspace_capability_required";
  }
  return null;
}

export function lotDenial(
  scope: StatusScope,
  operation: LotOperation,
  rights: StatusRights,
  options?: { readonly removesSelection?: boolean | undefined },
): RightsDenial | null {
  if (!["personal", "common"].includes(scope)) return "invalid_facet_command";
  if (scope === "personal" && operation !== "discard" && operation !== "restore") {
    return "invalid_facet_command";
  }
  switch (operation) {
    case "select":
    case "deselect":
      return rights.select ? null : "workspace_capability_required";
    case "discard": {
      if (scope === "personal" && !rights.discardPersonally) return "workspace_capability_required";
      if (scope === "common" && !rights.moderateArchive) return "workspace_capability_required";
      if (scope === "common" && options?.removesSelection === true && !rights.select) {
        return "workspace_capability_required";
      }
      return null;
    }
    case "restore":
      if (scope === "personal" && !rights.discardPersonally) return "workspace_capability_required";
      if (scope === "common" && !rights.moderateArchive) return "workspace_capability_required";
      return null;
    case "set_pipeline":
    case "clear_pipeline":
      return rights.changePipeline ? null : "workspace_capability_required";
    case "set_market":
    case "clear_market":
      return rights.changeMarket ? null : "workspace_capability_required";
    default:
      return "unknown_operation";
  }
}
