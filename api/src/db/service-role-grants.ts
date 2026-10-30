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
    -- Account admission: column reads plus the column UPDATE that SELECT ... FOR SHARE requires.
    GRANT USAGE ON SCHEMA public TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
    GRANT SELECT (id, sub, status), UPDATE (id) ON public.account_users TO ${IMMO_MCP_ARTIFACT_WRITER_ROLE};
    GRANT SELECT (account_id, workspace_id, status, revoked_at), UPDATE (workspace_id)
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
