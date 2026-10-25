/** Read-only operational metadata. Never selects connection parameters or business content. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";

export async function inspect(workspaceId: string | null) {
  const { db, pool } = createDb(loadConfig());
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
      await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
      const identity = (await tx.execute(sql`SELECT current_database() AS database,
        current_user AS role, current_schema() AS schema, current_setting('server_version_num') AS version,
        has_database_privilege(current_database(), 'CONNECT') AS connect,
        has_schema_privilege('public', 'USAGE') AS schema_usage,
        (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
          OR pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS observe_transactions`)).rows;
      const migrations = (await tx.execute<{ hash: string; created_at: string }>(sql`
        SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at`)).rows;
      const journal = JSON.parse(readFileSync("api/drizzle/meta/_journal.json", "utf8")) as {
        entries: { tag: string; when: number }[];
      };
      const expected = journal.entries.map(({ tag, when }) => ({ tag, when,
        hash: createHash("sha256").update(readFileSync(`api/drizzle/${tag}.sql`)).digest("hex") }));
      const missingMigrations = expected.filter((entry) => !migrations.some((row) =>
        row.hash === entry.hash && row.created_at === String(entry.when))).map(({ tag }) => tag);
      const approved = (await tx.execute<{ id: string; sub: string; status: string }>(sql`
        SELECT id, sub, status FROM account_users WHERE status='approved' ORDER BY id`)).rows;
      const workspaces = (await tx.execute(sql`SELECT id, slug, scope FROM workspaces ORDER BY id`)).rows;
      const memberships = (await tx.execute<{ account_id: string; status: string }>(sql`
        SELECT workspace_id, account_id, status, revision, moderate_archive, manage_members
        FROM workspace_memberships WHERE workspace_id=${workspaceId} ORDER BY account_id`)).rows;
      const attachments = (await tx.execute<{ account_id: string; workspace_id: string; status: string }>(sql`
        SELECT account_id, workspace_id, status FROM facet_stream_attachments
        WHERE account_id IN (SELECT id FROM account_users WHERE status='approved') ORDER BY account_id`)).rows;
      const personal = (await tx.execute(sql`SELECT workspace_id, writer_epoch, maintenance_barrier,
        old_index_dropped FROM facet_activation_state ORDER BY workspace_id`)).rows;
      const lots = (await tx.execute(sql`SELECT workspace_id, destination_open, maintenance_barrier
        FROM lot_cutover_state ORDER BY workspace_id`)).rows;
      const capabilities = (await tx.execute(sql`SELECT workspace_id, account_id, capability, granted, revision
        FROM lot_capability_grants WHERE workspace_id=${workspaceId} ORDER BY account_id, capability`)).rows;
      const privileges = (await tx.execute(sql`SELECT c.relname AS relation, r.rolname AS owner,
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
      const sequences = (await tx.execute(sql`SELECT c.relname,
        has_sequence_privilege(c.oid,'USAGE') AS usage FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'`)).rows;
      const functions = (await tx.execute(sql`SELECT p.proname, p.prosecdef,
        has_function_privilege(p.oid,'EXECUTE') AS execute FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
        AND p.proname IN ('facet_swap_head_enforcement','check_facet_stream') ORDER BY p.proname`)).rows;
      const indexAuthority = (await tx.execute(sql`SELECT c.relname AS index, t.relname AS relation,
        r.rolname AS table_owner, pg_has_role(current_user,t.relowner,'USAGE') AS can_drop_as_current_role
        FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid
        JOIN pg_roles r ON r.oid=t.relowner WHERE c.relname='facet_events_head_idx'`)).rows;
      const transactions = (await tx.execute(sql`SELECT count(*)::int AS active_transactions,
        count(*) FILTER (WHERE state='active')::int AS active_sessions
        FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
          AND (xact_start IS NOT NULL OR state='active')`)).rows;
      return { identity, migrations, missingMigrations, approved, workspaces, memberships, attachments, personal, lots,
        capabilities, privileges, sequences, functions, indexAuthority, transactions,
        differences: approved.map(({ id }) => ({ accountId: id,
          activeMember: memberships.some((row) => row.account_id === id && row.status === "active"),
          attachedHere: attachments.some((row) => row.account_id === id && row.workspace_id === workspaceId
            && row.status === "attached"),
          attachedElsewhere: attachments.some((row) => row.account_id === id && row.workspace_id !== workspaceId),
        })) };
    });
  } finally { await pool.end(); }
}
