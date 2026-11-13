import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";

export interface SignalMcpRef {
  workspaceId: string; scope: "personal" | "workspace"; citySlug: string;
  type: "Signal" | "DesignationEvent"; id: string;
}
export interface SignalMcpEntry {
  id: string; source: "mcp" | "manual" | "ai"; model: string | null;
  validation: "auto" | "human"; classe?: "pertinent" | "a_surveiller" | "ecarte" | "non_classe";
  reason?: string; text?: string; created_at: string;
}
export interface SignalMcpState {
  version: string; current: SignalMcpEntry | null; notes: SignalMcpEntry[];
  feedback: unknown[]; mcpHistory: SignalMcpEntry[]; history: unknown[]; error?: string;
}
export async function readSignalMcp(db: Database, sub: string, ref: SignalMcpRef): Promise<SignalMcpState> {
  const rows = await db.execute(sql`SELECT signal_mcp_read(${sub},${JSON.stringify(ref)}::jsonb) AS state`);
  return rows.rows[0]!.state as unknown as SignalMcpState;
}
export async function readSignalMcpCity(db: Database, sub: string, workspaceId: string, citySlug: string) {
  const rows = await db.execute(sql`SELECT n.id,n.type,signal_mcp_read(${sub},jsonb_build_object(
    'workspaceId',${workspaceId}::text,'scope','personal','citySlug',n.city_slug,'type',n.type,'id',n.id)) AS state
    FROM graph_nodes n WHERE n.city_slug=${citySlug} AND n.type IN ('Signal','DesignationEvent')`);
  return new Map(rows.rows.map((row) => [JSON.stringify([row.type, row.id]), row.state as unknown as SignalMcpState]));
}
export async function addSignalNote(db: Database, sub: string, ref: SignalMcpRef, text: string, version: string) {
  const body = JSON.stringify({ signalRef: ref, text });
  const hash = createHash("sha256").update(body).digest("hex");
  const rows = await db.execute(sql`SELECT signal_mcp_write(${sub},'browser','annotate_signal',${body}::jsonb,
    'human',${version},${hash},'manual') AS result`);
  return rows.rows[0]!.result as { id?: string; error?: string };
}
