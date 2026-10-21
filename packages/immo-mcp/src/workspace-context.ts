/**
 * 6H explicit per-call workspace context for MCP-mediated API reads.
 *
 * The workspace always comes from the caller: either the single explicit
 * tool argument or the verified auth context. Missing or ambiguous context
 * fails; transport defaults such as `radar/default` are never substituted.
 * A requested workspace outside the authorized set is refused, never mapped
 * onto an authorized one.
 */

export class WorkspaceContextError extends Error {
  constructor(
    public code: "workspace_missing" | "workspace_ambiguous" | "workspace_not_authorized",
    message: string,
  ) {
    super(message);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the workspace for one MCP call. `requested` is the explicit tool
 * argument; `authorized` is the verified auth-context set. Absent without
 * exactly one authorized workspace fails; several authorized workspaces
 * without an explicit request fail as ambiguous.
 */
export function resolveWorkspaceContext(
  authorized: string[], requested?: string | null,
): string {
  if (authorized.some((id) => !UUID_PATTERN.test(id))) {
    throw new WorkspaceContextError("workspace_missing", "workspace_missing");
  }
  const distinct = [...new Set(authorized.map((id) => id.toLowerCase()))].sort();
  if (requested !== undefined && requested !== null) {
    if (!UUID_PATTERN.test(requested)) {
      throw new WorkspaceContextError("workspace_missing", "workspace_missing");
    }
    const match = distinct.find((entry) => entry.toLowerCase() === requested.toLowerCase());
    if (!match) throw new WorkspaceContextError("workspace_not_authorized", "workspace_not_authorized");
    return match;
  }
  if (distinct.length === 0) throw new WorkspaceContextError("workspace_missing", "workspace_missing");
  if (distinct.length > 1) throw new WorkspaceContextError("workspace_ambiguous", "workspace_ambiguous");
  return distinct[0]!;
}
