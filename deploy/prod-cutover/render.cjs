/* global require, module, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
const settings = require('./prod-settings.json');
function render(planText) {
  const plan = JSON.parse(planText);
  if (plan.version !== 1 || !plan.accounts?.length) r.fail('invalid_render_plan');
  const cm = (name, data) => ({ apiVersion: 'v1', kind: 'ConfigMap',
    metadata: { name, namespace: 'radar-immobilier' }, data });
  return { apiVersion: 'v1', kind: 'List', items: [
    cm('radar-api', { ...settings.shared, ...settings.api }),
    cm('immo-mcp-config', { ...settings.shared, ...settings.mcp }),
    cm('radar-mcp-receiver', settings.receiver),
    cm('radar-cutover-6h', { 'plan.json': planText }),
  ] };
}
if (require.main === module) {
  const planText = r.fs.readFileSync(r.safeFile(r.env.PLAN), 'utf8');
  const file = r.env.CONFIGURATION;
  if (!file || !r.path.isAbsolute(file) || r.fs.existsSync(file)) r.fail('new_absolute_configuration_required');
  r.fs.writeFileSync(file, JSON.stringify(render(planText), null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
module.exports = { render };
