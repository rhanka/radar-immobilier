/* global require, module, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
const { bindings } = require('./prod-bindings.cjs');
function requiredSecrets() {
  const required = {};
  for (const binding of Object.values(bindings)) for (const env of binding.env) {
    const ref = env.valueFrom.secretKeyRef;
    if (ref) (required[ref.name] ||= new Set()).add(ref.key);
  }
  required['radar-artifact-content-prod-tls'] = new Set(['tls.crt', 'tls.key']);
  return required;
}
function checkSecrets(read) {
  for (const [name, keys] of Object.entries(requiredSecrets())) {
    const sizes = read(name);
    for (const key of keys) {
      if (!Number.isInteger(sizes[key]) || sizes[key] <= 0) r.fail(`required_secret_missing_${name.replaceAll('-', '_')}`);
    }
  }
  return { ok: true, secrets: Object.keys(requiredSecrets()).length, valuesPrinted: false };
}
function precheck() {
  const kube = r.path.join(r.env.HOME, '.kube/radar-prod-tenant-admin.kubeconfig');
  return checkSecrets(name => {
    // Only names and encoded lengths reach stdout. Never request secret values as output.
    const lines = r.run('kubectl', ['--kubeconfig', kube, '--request-timeout=15s', '-n', 'radar-immobilier',
      'get', 'secret', name, '-o', 'go-template={{range $key, $value := .data}}{{$key}}={{len $value}}{{"\\n"}}{{end}}']);
    return Object.fromEntries(lines.trim().split('\n').filter(Boolean).map(line => {
      const [key, length] = line.split('='); return [key, Number(length)];
    }));
  });
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(precheck()) + '\n'); }
  catch { process.stderr.write('required_production_secret_missing\n'); process.exitCode = 1; }
}
module.exports = { requiredSecrets, checkSecrets };
