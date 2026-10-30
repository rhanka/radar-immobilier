/**
 * Idempotent privileges of the restricted MCP database roles.
 *
 * Restores replay archives with `--no-owner --no-privileges` and the cutover
 * creates the prepared database from `template0`, so every GRANT is lost on
 * each restore. Migrations run once per journal row and cannot carry them.
 * The migrator therefore re-asserts these privileges after every run, on the
 * database it migrated (live CD database or cutover prepared database).
 *
 * Roles are created and given passwords by operators; an absent role is
 * skipped (development, CI). Static SQL only: no identifier comes from input.
 */
export const IMMO_MCP_ARTIFACT_WRITER_ROLE = "immo_mcp_artifact_writer";
export const IMMO_MCP_ACCOUNT_READER_ROLE = "immo_mcp_account_reader";

export const SERVICE_ROLE_GRANTS_SQL = `DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${IMMO_MCP_ACCOUNT_READER_ROLE}') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${IMMO_MCP_ACCOUNT_READER_ROLE}', current_database());
    GRANT USAGE ON SCHEMA public TO ${IMMO_MCP_ACCOUNT_READER_ROLE};
    GRANT SELECT (id, sub, status) ON public.account_users TO ${IMMO_MCP_ACCOUNT_READER_ROLE};
    GRANT SELECT (account_id, workspace_id, status, revoked_at)
      ON public.workspace_memberships TO ${IMMO_MCP_ACCOUNT_READER_ROLE};
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${IMMO_MCP_ARTIFACT_WRITER_ROLE}') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE}', current_database());
    -- Startup guard: migration journal hashes (0016, 0024).
    GRANT USAGE ON SCHEMA drizzle TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
    GRANT SELECT ON drizzle.__drizzle_migrations TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
    -- Artifact host and commit coordinator: DML on every artifacts table.
    GRANT USAGE ON SCHEMA artifacts TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA artifacts TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA artifacts TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
    -- Account admission: column reads, plus the UPDATE on one column that
    -- SELECT ... FOR SHARE requires. The column is created_at on both tables:
    -- workspace_memberships has a composite key (workspace_id, account_id) and
    -- every key or authorization column (id, sub, status, workspace_id,
    -- account_id, revoked_at, capability flags) would let the writer rewrite
    -- identity or membership scope. created_at is an audit timestamp that no
    -- authorization path reads. Table-level REVOKE first also removes any
    -- column UPDATE granted earlier, so replays converge to this exact set.
    GRANT USAGE ON SCHEMA public TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
    REVOKE UPDATE ON public.account_users, public.workspace_memberships FROM ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
    GRANT SELECT (id, sub, status), UPDATE (created_at) ON public.account_users TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
    GRANT SELECT (account_id, workspace_id, status, revoked_at), UPDATE (created_at)
      ON public.workspace_memberships TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
  END IF;
END
$grants$;`;

export interface GrantQuery {
  query(sql: string): Promise<unknown>;
}

export async function applyServiceRoleGrants(db: GrantQuery): Promise<void> {
  await db.query(SERVICE_ROLE_GRANTS_SQL);
}
