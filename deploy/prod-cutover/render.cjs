/* global require, module, process, structuredClone */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
const settings = require('./prod-settings.json');
function contentIngress(host = settings.shared.ARTIFACTS_CONTENT_BASE) {
  render(JSON.stringify({ version: 1, accounts: [{}] }), host);
  const ingress = structuredClone(require('./prod-content-ingress.json'));
  ingress.spec.tls[0].hosts = [`*.${host}`];
  ingress.spec.rules[0].host = `*.${host}`;
  return ingress;
}
function render(planText, contentHost = settings.shared.ARTIFACTS_CONTENT_BASE) {
  const plan = JSON.parse(planText);
  if (plan.version !== 1 || !plan.accounts?.length) r.fail('invalid_render_plan');
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(contentHost))
    r.fail('invalid_artifacts_content_host');
  const cm = (name, data) => ({ apiVersion: 'v1', kind: 'ConfigMap',
    metadata: { name, namespace: 'radar-immobilier' }, data });
  return { apiVersion: 'v1', kind: 'List', items: [
    cm('radar-api', { ...settings.shared, ARTIFACTS_CONTENT_BASE: contentHost, ...settings.api }),
    cm('immo-mcp-config', { ...settings.shared, ARTIFACTS_CONTENT_BASE: contentHost, ...settings.mcp }),
    cm('radar-mcp-receiver', settings.receiver),
    cm('radar-cutover-6h', { 'plan.json': planText }),
  ] };
}
if (require.main === module) {
  const file = r.env.CONFIGURATION;
  if (!file || !r.path.isAbsolute(file) || r.fs.existsSync(file)) r.fail('new_absolute_configuration_required');
  const host = r.env.ARTIFACTS_CONTENT_HOST || settings.shared.ARTIFACTS_CONTENT_BASE;
  const manifest = process.argv[2] === 'content-ingress' ? contentIngress(host)
    : render(r.fs.readFileSync(r.safeFile(r.env.PLAN), 'utf8'), host);
  r.fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
module.exports = { render, contentIngress };
