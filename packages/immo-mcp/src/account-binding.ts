import pg from "pg";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";

export interface AccountQuery {
  query(sql: string, args: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Trusted read-only binding, queried for each call; caller arguments never supply identity. */
export function accountAuthorizer(db: AccountQuery) {
  return async (_tool: string, request: VerifiedMcpRequest): Promise<boolean> => {
    const rows = await db.query("SELECT id, status FROM account_users WHERE sub = $1 LIMIT 1", [request.principal.sub]);
    const account = rows.rows[0];
    if (account?.status !== "approved") return false;
    const workspaces = request.principal.attributes.workspaces;
    if (!Array.isArray(workspaces) || workspaces.some((w) => typeof w !== "string")) return false;
    // The historical default is a transport placeholder, never a membership assertion.
    const ids = [...new Set(workspaces.filter((w: string) => w !== "default"))];
    if (ids.length === 0) return true;
    if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) return false;
    const memberships = await db.query(
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
  return { authorize: accountAuthorizer(pool), close: () => pool.end() };
}
