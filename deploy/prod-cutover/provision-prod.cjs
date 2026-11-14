/* global require, module, process, Buffer, URL, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
const roles = [
  ['immo_mcp_artifact_writer', 'immo-mcp-artifact-writer', 'IMMO_MCP_ARTIFACT_DATABASE_URL'],
  ['immo_mcp_account_reader', 'immo-mcp-account-reader', 'IMMO_MCP_ACCOUNT_DATABASE_URL'],
];
const keys = {
  'radar-artifacts-prod': ['ARTIFACTS_S3_ACCESS_KEY', 'ARTIFACTS_S3_SECRET_KEY'],
  'radar-artifacts-upload-page-prod': ['secret'],
  'radar-artifacts-reader-prod': ['ARTIFACTS_READER_GRANT_SECRET', 'ARTIFACTS_READER_SESSION_SECRET'],
  ...Object.fromEntries(roles.map(([, name, key]) => [name, [key]])),
};
const kube = ['--kubeconfig', r.path.join(r.env.HOME, '.kube/radar-prod-tenant-admin.kubeconfig'),
  '--request-timeout=15s', '-n', 'radar-immobilier'];
const k = (...args) => r.run('kubectl', [...kube, ...args]);
const get = (kind, name) => {
  const value = k('get', kind, name, '--ignore-not-found', '-o', 'json');
  return value.trim() ? JSON.parse(value) : null;
};
function provision() {
  if (r.env.ENV !== 'prod' || !['', '0', '1'].includes(r.env.APPLY || '')) r.fail('provision_lane_refused');
  const apply = r.env.APPLY === '1';
  if (k('config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}').trim()
    !== 'https://hlhedx.c1.bhs5.k8s.ovh.net') r.fail('cluster_mismatch');
  if (get('configmap', 'radar-change-lock')) r.fail('active_change_lock');
  for (const kind of ['secrets', 'certificates.cert-manager.io', 'ingresses.networking.k8s.io', 'pods/exec']) {
    if (k('auth', 'can-i', 'create', kind).trim() !== 'yes') r.fail('provision_permission_missing');
  }
  const podList = JSON.parse(k('get', 'pods', '-o', 'json')).items;
  const pods = podList.filter(p => /^radar-postgres-/.test(p.metadata.name) && p.status.phase === 'Running');
  if (pods.length !== 1) r.fail('unique_postgres_required');
  const query = (text, readonly = true) => r.run('kubectl', [...kube, 'exec', '-i', pods[0].metadata.name,
    '--', 'sh', '-c', `PGOPTIONS='-c default_transaction_read_only=${readonly ? 'on' : 'off'} -c statement_timeout=15000 -c lock_timeout=3000' psql -XqAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --file=-`], { input: text });
  const database = JSON.parse(query(`SELECT json_build_object('db',current_database(),'admin',
    (SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname=current_user),'roles',
    (SELECT coalesce(json_agg(json_build_object('name',rolname,'safe',rolcanlogin AND NOT
    (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))),'[]')
    FROM pg_roles WHERE rolname IN ('immo_mcp_artifact_writer','immo_mcp_account_reader')));`));
  if (database.db !== 'radar' || !database.admin || database.roles.some(role => !role.safe)) r.fail('database_precheck_failed');
  const existing = Object.fromEntries(Object.keys(keys).map(name => [name, get('secret', name)]));
  for (const [name, object] of Object.entries(existing)) {
    if (object && keys[name].some(key => !object.data?.[key] || !Buffer.from(object.data[key], 'base64').length)) r.fail('existing_secret_incomplete');
  }
  const ingress = r.json(r.path.join(__dirname, 'prod-content-ingress.json'));
  const certificate = { apiVersion: 'cert-manager.io/v1', kind: 'Certificate',
    metadata: { name: 'radar-artifact-content-prod', namespace: 'radar-immobilier' },
    spec: { secretName: 'radar-artifact-content-prod-tls', dnsNames: ['*.pages.immo.sent-tech.ca'],
      issuerRef: { name: 'letsencrypt-prod', kind: 'ClusterIssuer' } } };
  const objects = [certificate, ingress];
  const current = objects.map(object => get(object.kind, object.metadata.name));
  for (let i = 0; i < objects.length; i++) {
    if (current[i] && !contains(current[i].spec, objects[i].spec)) r.fail('existing_resource_conflict');
  }
  for (const [role, name, key] of roles) {
    const found = database.roles.some(item => item.name === role);
    if (found && !existing[name]) r.fail('existing_role_without_secret');
    if (existing[name]) roleUrl(existing[name], key, role);
  }
  const plan = [ ...Object.keys(keys).map(name => `${existing[name] ? 'KEEP' : 'CREATE'} Secret/${name}`),
    ...objects.map((object, i) => `${current[i] ? 'KEEP' : 'CREATE'} ${object.kind}/${object.metadata.name}`),
    ...roles.map(([role]) => `${database.roles.some(item => item.name === role) ? 'KEEP' : 'CREATE'} Role/${role}`) ];
  if (apply) require('./provision-apply.cjs').apply({ existing, keys, roles, objects, current, database, k, query, roleUrl });
  return { mode: apply ? 'APPLY' : '--dry-run', precheck: 'ok', plan,
    deferred: ['TLS Ready after DNS-01 issuance', 'bucket CORS by k8s administrator', 'candidate grants by migrator'],
    dotenvRead: apply && !existing['radar-artifacts-prod'], valuesPrinted: false };
}
function contains(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => contains(actual[i], v));
  if (expected && typeof expected === 'object') return actual && Object.entries(expected).every(([key, value]) => contains(actual[key], value));
  return actual === expected;
}
function roleUrl(object, key, role) {
  const url = new URL(Buffer.from(object.data[key], 'base64').toString('utf8'));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.username !== role || !url.password
    || url.hostname !== 'radar-postgres' || !['', '5432'].includes(url.port) || url.pathname !== '/radar'
    || url.search) r.fail('role_url_mismatch');
  return decodeURIComponent(url.password);
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(provision(), null, 2) + '\n'); }
  catch { process.stderr.write('provision_prod_precheck_or_apply_failed\n'); process.exitCode = 1; }
}
module.exports = { provision, contains, roleUrl };
