/* global require, process, URL, Buffer */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
// Future window only. The candidate migrator grants privileges; it skips absent roles.
function provision() {
  if (r.env.ENV !== 'execution-prod') r.fail('future_production_window_only');
  r.destination(); r.mutationGuard(); r.approvedPlan(); r.evidence();
  const kube = r.path.join(r.env.HOME, '.kube/radar-prod-tenant-admin.kubeconfig');
  const roles = [
    ['immo_mcp_artifact_writer', 'immo-mcp-artifact-writer', 'IMMO_MCP_ARTIFACT_DATABASE_URL'],
    ['immo_mcp_account_reader', 'immo-mcp-account-reader', 'IMMO_MCP_ACCOUNT_DATABASE_URL'],
  ];
  for (const [role, secret, key] of roles) {
    const object = JSON.parse(r.run('kubectl', ['--kubeconfig', kube, '--request-timeout=15s',
      '-n', 'radar-immobilier', 'get', 'secret', secret, '-o', 'json']));
    const url = new URL(Buffer.from(object.data[key], 'base64').toString('utf8'));
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.username !== role
      || url.pathname !== '/radar' || !url.password) r.fail('role_secret_identity_mismatch');
    const password = decodeURIComponent(url.password).replaceAll("'", "''");
    if (password.includes('$role$')) r.fail('unsupported_role_password_delimiter');
    // Passwords stay on stdin. Existing roles are retained; rotation is a separate operation.
    r.sql(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('immo-prod-cutover-v1220',0));
      DO $role$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
        CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}' AND
        (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
        RAISE EXCEPTION 'restricted_login_role_required';
      END IF; END $role$; COMMIT;`);
  }
  return { ok: true, roles: roles.map(([role]) => role), passwordsPrinted: false };
}
try { process.stdout.write(JSON.stringify(provision()) + '\n'); }
catch { process.stderr.write('artifact_role_provision_refused\n'); process.exitCode = 1; }
