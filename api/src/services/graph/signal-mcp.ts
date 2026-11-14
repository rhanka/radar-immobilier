import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { approvedAccountId } from "../workspaces/store.js";
import { lockCityGraph } from "./graph-store.js";
import { FacetError, type SignalTarget } from "../facets/target.js";

export interface SignalMcpRef {
  workspaceId: string; scope: "personal" | "workspace"; citySlug: string;
  type: "Signal" | "DesignationEvent"; id: string;
}
export interface SignalMcpEntry {
  id: string; source: "mcp" | "manual" | "ai"; model: string | null;
  validation: "auto" | "human"; pending_human?: boolean; scope?: "personal" | "workspace";
  actor_id?: string; linked_event_id?: string; reason_code?: string; classe?: "pertinent" | "a_surveiller" | "ecarte" | "non_classe";
  reason?: string; text?: string; created_at: string;
}
export interface SignalMcpState {
  version: string; current: SignalMcpEntry | null; notes: SignalMcpEntry[];
  feedback: unknown[]; mcpHistory: SignalMcpEntry[]; history: unknown[]; error?: string;
  canConfirm?: boolean; moderateArchive?: boolean;
}

/** Called under the workspace lock by every personal UI writer. */
export async function assertNoMcpSharedArchive(db: Database, sub: string, workspaceId: string, target: SignalTarget) {
  const state = await readSignalMcp(db, sub, { ...target, workspaceId, scope: "personal" });
  if (state.current?.scope === "workspace" && state.current.classe === "ecarte") {
    throw new FacetError(state.moderateArchive ? 409 : 403,
      state.moderateArchive ? "workspace_archive_restore_required" : "workspace_capability_required");
  }
}

/** Browser-only human decision. The original MCP event always remains automatic. */
export async function decideSignalMcp(db: Database, sub: string, ref: SignalMcpRef, version: string,
  choice: { classe: NonNullable<SignalMcpEntry["classe"]>; reasonCode?: string | undefined; confirm?: boolean | undefined }) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, ref.workspaceId);
    const actor = await approvedAccountId(tx, sub, true);
    await lockCityGraph(tx, ref.citySlug);
    const state = await readSignalMcp(tx, sub, ref);
    if (state.error) throw new FacetError(403, state.error);
    if (state.version !== version) throw new FacetError(409, "annotation_version_conflict");
    const current = state.current;
    if (!current || (current.source !== "mcp" && !current.linked_event_id)) {
      throw new FacetError(409, "mcp_classification_required");
    }
    if (choice.confirm && (!state.canConfirm || choice.classe !== current.classe)) {
      throw new FacetError(403, "same_actor_confirmation_required");
    }
    if (current.scope === "workspace" && !state.moderateArchive) throw new FacetError(403, "workspace_capability_required");
    const code = choice.confirm ? current.reason_code : choice.reasonCode;
    if (choice.classe !== "non_classe" && code) {
      const codes = await tx.execute(sql`SELECT code FROM facet_reason_codes WHERE profile_id='immo-steve-2026-09'
        AND code=${code} AND verdict=${choice.classe === "ecarte" ? "non_pertinent" : choice.classe}`);
      if (!codes.rows.length) throw new FacetError(422, "invalid_reason_code");
    }
    if (choice.classe === "ecarte" && !code) throw new FacetError(422, "reason_code_required");
    const append = async (scope: string, classe: string) => tx.execute(sql`INSERT INTO signal_mcp_events
      (workspace_id,actor_id,scope,city_slug,node_type,node_id,kind,source,oauth_sub,validation,
        classe,reason_code,reason,previous_version,linked_event_id,verdict)
      VALUES (${ref.workspaceId},${actor},${scope},${ref.citySlug},${ref.type},${ref.id},
        'class','manual',${sub},'human',${classe},${code ?? null},${choice.confirm ? "Validated: " + current.reason : "UI reclassification"},
        ${version},${current.id},${choice.confirm ? "up" : null}) RETURNING id`);
    if (current.scope === "workspace" && choice.classe !== "ecarte") await append("workspace", "non_classe");
    await append(current.scope === "workspace" && choice.classe === "ecarte" ? "workspace" : "personal", choice.classe);
    if (current.scope === "workspace") await tx.execute(sql`INSERT INTO workspace_projection_revisions(workspace_id,city_slug,mode,revision)
      VALUES (${ref.workspaceId},${ref.citySlug},'signal',1) ON CONFLICT(workspace_id,city_slug,mode)
      DO UPDATE SET revision=workspace_projection_revisions.revision+1,updated_at=now()`);
    await tx.execute(sql`INSERT INTO personal_projection_revisions(workspace_id,owner_id,city_slug,mode,revision)
      VALUES (${ref.workspaceId},${actor},${ref.citySlug},'signal',1) ON CONFLICT(workspace_id,owner_id,city_slug,mode)
      DO UPDATE SET revision=personal_projection_revisions.revision+1,updated_at=now()`);
    return readSignalMcp(tx, sub, ref);
  });
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
