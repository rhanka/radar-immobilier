import type { Database } from "../../db/client.js";
import { McpWorkspaceId } from "../../routes/mcp-signal-search.js";
import { listWorkspacesForAccount } from "../workspaces/store.js";
import { ScopeError } from "./scope.js";

/** Memberships are read from PostgreSQL for the verified human subject. */
export async function resolveMcpSignalWorkspace(
  db: Database, sub: string, selector?: string,
): Promise<string> {
  const parsed = selector === undefined ? undefined : McpWorkspaceId.safeParse(selector);
  if (parsed && !parsed.success) throw new ScopeError(400, "workspace_malformed");
  const memberships = await listWorkspacesForAccount(db, sub);
  const ids = [...new Set(memberships.map((entry) => entry.workspace.id))];
  if (parsed?.success) {
    if (!ids.includes(parsed.data)) throw new ScopeError(403, "workspace_not_authorized");
    return parsed.data;
  }
  if (ids.length === 0) throw new ScopeError(403, "workspace_missing");
  if (ids.length !== 1) throw new ScopeError(409, "workspace_ambiguous");
  return ids[0]!;
}
