/* global require, module, Buffer, URL */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
function apply({ existing, keys, roles, objects, current, database, k, query, roleUrl }) {
  // Validate every private input before the first mutation. Dry-run never calls this module.
  const pending = {};
  if (!existing['radar-artifacts-prod']) {
    const file = r.env.ARTIFACTS_PROD_ENV_FILE;
    if (!file || !r.path.isAbsolute(file) || r.fs.lstatSync(file).isSymbolicLink()
      || !r.fs.statSync(file).isFile() || (r.fs.statSync(file).mode & 0o077)) r.fail('private_s3_input_required');
    const values = {};
    for (const line of r.fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^(?:export\s+)?(ARTIFACTS_PROD_S3_[A-Z_]+)=(.*)$/);
      if (!match) continue;
      let value = match[2].trim();
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      if (Object.hasOwn(values, match[1])) r.fail('duplicate_s3_input');
      values[match[1]] = value;
    }
    const expected = { ENDPOINT: 'https://s3.bhs.io.cloud.ovh.net', REGION: 'bhs',
      BUCKET: 'radar-immobilier-artifacts', PREFIX: 'artifacts/radar-immobilier/' };
    for (const [suffix, value] of Object.entries(expected)) {
      if (values[`ARTIFACTS_PROD_S3_${suffix}`] !== value) r.fail('s3_configuration_mismatch');
    }
    for (const suffix of ['ACCESS_KEY', 'SECRET_KEY', 'USER', 'USERID']) {
      if (!values[`ARTIFACTS_PROD_S3_${suffix}`]) r.fail('s3_input_missing');
    }
    pending['radar-artifacts-prod'] = Object.fromEntries(keys['radar-artifacts-prod']
      .map(key => [key, values[key.replace('ARTIFACTS_S3_', 'ARTIFACTS_PROD_S3_')]]));
  }
  for (const name of ['radar-artifacts-upload-page-prod', 'radar-artifacts-reader-prod']) {
    if (!existing[name]) pending[name] = Object.fromEntries(keys[name].map(key => [key, r.crypto.randomBytes(32).toString('hex')]));
  }
  for (const [role, name, key] of roles) {
    if (!existing[name]) {
      const url = new URL(`postgresql://${role}@radar-postgres:5432/radar`);
      url.password = r.crypto.randomBytes(32).toString('hex');
      pending[name] = { [key]: url.toString() };
    }
  }
  // Create-only semantics. A race is refused; existing keys are never rotated here.
  for (const [name, stringData] of Object.entries(pending)) {
    const object = { apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
      metadata: { name, namespace: 'radar-immobilier' }, stringData };
    r.run('kubectl', ['--kubeconfig', r.path.join(r.env.HOME, '.kube/radar-prod-tenant-admin.kubeconfig'),
      '--request-timeout=15s', '-n', 'radar-immobilier', 'create', '-f', '-'], { input: JSON.stringify(object) });
    existing[name] = { data: Object.fromEntries(Object.entries(stringData).map(([key, value]) => [key, Buffer.from(value).toString('base64')])) };
  }
  for (const [role, name, key] of roles) {
    if (database.roles.some(item => item.name === role)) continue;
    const password = roleUrl(existing[name], key, role).replaceAll("'", "''");
    if (password.includes('$role$')) r.fail('unsupported_role_password');
    query(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('immo-prod-cutover-v1220',0));
      DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
      CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}';
      END IF; END $role$; COMMIT;`, false);
  }
  for (let i = 0; i < objects.length; i++) {
    if (!current[i]) r.run('kubectl', ['--kubeconfig', r.path.join(r.env.HOME, '.kube/radar-prod-tenant-admin.kubeconfig'),
      '--request-timeout=15s', '-n', 'radar-immobilier', 'create', '-f', '-'], { input: JSON.stringify(objects[i]) });
  }
  void k;
}
module.exports = { apply };
