-- Parameters are psql identifiers, not interpolated SQL fragments.
-- One-time role creation; inspect an existing role instead of replacing it.
CREATE ROLE :"reader" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION CONNECTION LIMIT 4;
ALTER ROLE :"reader" SET default_transaction_read_only = on;
ALTER ROLE :"reader" SET statement_timeout = '2s';
GRANT CONNECT ON DATABASE :"database" TO :"reader";
GRANT USAGE ON SCHEMA public TO :"reader";
GRANT SELECT (id, sub, status) ON public.account_users TO :"reader";
GRANT SELECT (account_id, workspace_id, status, revoked_at)
  ON public.workspace_memberships TO :"reader";
-- Both must be false. No inherited roles or public write grants are acceptable.
SELECT has_table_privilege(:'reader', 'public.account_users', 'INSERT,UPDATE,DELETE') AS account_write,
  has_table_privilege(:'reader', 'public.workspace_memberships', 'INSERT,UPDATE,DELETE') AS membership_write;
