/** SQL operations, including SELECT FOR SHARE/UPDATE, checked before any child can mutate. */
import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import requirements from "./base-preprod-rights.json" with { type: "json" };

export async function readPrivileges(db: Pick<Database, "execute">) {
  return (await db.execute(sql`SELECT c.relname AS relation, r.rolname AS owner,
    has_table_privilege(c.oid,'SELECT') AS read,
    has_table_privilege(c.oid,'INSERT') AS insert,
    has_table_privilege(c.oid,'UPDATE') AS update,
    has_table_privilege(c.oid,'DELETE') AS delete,
    (has_table_privilege(c.oid,'UPDATE') OR has_table_privilege(c.oid,'DELETE')
      OR has_table_privilege(c.oid,'TRUNCATE')) AS lock_authority,
    pg_has_role(current_user,c.relowner,'USAGE') AS owner_effective
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname IN (
      'account_users','workspaces','workspace_memberships','workspace_membership_events',
      'facet_streams','facet_event_bindings','facet_heads','facet_stream_attachments',
      'facet_command_contexts','facet_activation_state','facet_unresolved_events',
      'facet_events','facet_commands','personal_projection_revisions','workspace_projection_revisions')
    ORDER BY c.relname`)).rows;
}

export function sufficientPrivileges(rows: Record<string, unknown>[], action: keyof typeof requirements) {
  return Object.entries(requirements[action]).every(([privilege, relations]) =>
    relations.every((relation) => rows.some((row) => row.relation === relation && row[privilege] === true)));
}

export async function assertPrivileges(db: Pick<Database, "execute">, action: "init" | "attach" | "activate" | "resume") {
  if (!sufficientPrivileges(await readPrivileges(db), action === "resume" ? "activate" : action)) {
    throw new Error("operator_sql_privileges_missing");
  }
  if (action === "activate" || action === "resume") {
    const [rights] = (await db.execute(sql`SELECT
      has_function_privilege('public.check_facet_stream(uuid)','EXECUTE')
        AND has_function_privilege('public.facet_swap_head_enforcement(uuid)','EXECUTE') AS execute,
      NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public' AND c.relname='facet_events_head_idx'
          AND NOT pg_has_role(current_user,t.relowner,'USAGE')) AS drop_index`)).rows;
    if (rights?.execute !== true || rights.drop_index !== true) throw new Error("operator_sql_authority_missing");
  }
}
