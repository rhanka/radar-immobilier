import pg from "pg";
import { bindDatabaseName } from "./database-url.js";

export interface SignalQuery {
  query(text: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface SignalRuntime {
  readonly db: SignalQuery;
  readonly confirm?: (message: string) => Promise<boolean>;
}
export function createSignalBinding(env: NodeJS.ProcessEnv): pg.Pool | undefined {
  if (env.IMMO_MCP_SIGNALS_WRITE_ENABLED !== "1") return undefined;
  const url = env.IMMO_MCP_SIGNAL_DATABASE_URL;
  if (!url) throw new Error("signal_database_binding_required");
  return new pg.Pool({ connectionString: bindDatabaseName(url, env.IMMO_MCP_DATABASE_NAME), max: 3,
    connectionTimeoutMillis: 2000, statement_timeout: 5000 });
}
export async function readSignal(db: SignalQuery, sub: string, ref: unknown): Promise<Record<string, unknown>> {
  const result = await db.query("SELECT signal_mcp_read($1,$2::jsonb) AS state", [sub, JSON.stringify(ref)]);
  return result.rows[0]?.state as Record<string, unknown>;
}
