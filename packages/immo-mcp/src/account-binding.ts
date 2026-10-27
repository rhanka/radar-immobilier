import pg from "pg";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { ARTIFACT_TOOL_NAMES } from "./registry/artifact-profile.js";

/**
 * General opening (artefacts-ouverture L2): the four artifact tools publish
 * for every approved account. Stale workspace claims never block publication;
 * the host admission (account status reread at entry, commit and replay, plus
 * the shared storage rules) stays the governing gate. Business tools keep
 * their membership controls unchanged.
 */
const ARTIFACT_TOOLS = new Set<string>(ARTIFACT_TOOL_NAMES);

export interface AccountQuery {
  query(sql: string, args: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export class AccountBindingUnavailable extends Error {
  readonly retriable = true;
  constructor() { super("account_binding_unavailable"); this.name = "AccountBindingUnavailable"; }
}

function logAccountDisconnect(): void {
  process.stderr.write('{"kind":"immo-mcp.account","error":"account_binding_unavailable","retriable":true}\n');
}

/** Trusted read-only binding, queried for each call; caller arguments never supply identity. */
export function accountAuthorizer(db: AccountQuery) {
  const read: AccountQuery["query"] = async (sql, args) => {
    try { return await db.query(sql, args); }
    catch { throw new AccountBindingUnavailable(); }
  };
  return async (_tool: string, request: VerifiedMcpRequest): Promise<boolean> => {
    const rows = await read("SELECT id, status FROM account_users WHERE sub = $1 LIMIT 1", [request.principal.sub]);
    const account = rows.rows[0];
    if (account?.status !== "approved") return false;
    if (ARTIFACT_TOOLS.has(_tool)) return true;
    const workspaces = request.principal.attributes.workspaces;
    if (!Array.isArray(workspaces) || workspaces.some((w) => typeof w !== "string")) return false;
    // The historical default is a transport placeholder, never a membership assertion.
    const ids = [...new Set(workspaces.filter((w: string) => w !== "default"))];
    if (ids.length === 0) return true;
    if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return false;
    const memberships = await read(
      "SELECT workspace_id FROM workspace_memberships WHERE account_id = $1 AND workspace_id = ANY($2::uuid[]) AND status = 'active' AND revoked_at IS NULL",
      [account.id, ids],
    );
    return new Set(memberships.rows.map((row) => String(row.workspace_id).toLowerCase())).size === ids.length;
  };
}

export function createAccountBinding(env: NodeJS.ProcessEnv) {
  const url = env.IMMO_MCP_ACCOUNT_DATABASE_URL;
  if (!url) return undefined;
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10_000, options: "-c default_transaction_read_only=on -c statement_timeout=2000" });
  // pg evicts the broken idle client before emitting; the next query opens a fresh connection.
  pool.on("error", logAccountDisconnect);
  return { authorize: accountAuthorizer(pool), close: () => pool.end() };
}
