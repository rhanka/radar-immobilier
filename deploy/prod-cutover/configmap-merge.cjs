/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
// window-configure merges rendered keys into live ConfigMaps (kubectl patch --type=merge).
// It never replaces a map: the render is partial by design (incident 2026-11-14).
const settings = require('./prod-settings.json');
const fail = code => { throw new Error(code); };
const WHOLE = 'radar-cutover-6h';
const strings = data => data && typeof data === 'object' && !Array.isArray(data)
  && Object.keys(data).length > 0 && Object.values(data).every(v => typeof v === 'string');
// Result of a JSON merge patch {data} on a ConfigMap: live keys stay, rendered keys win.
const merged = (live, rendered) => ({ ...(live?.data || {}), ...rendered.data });
function retention(items, live, retained = settings.retained) {
  const liveItems = live?.kind === 'List' || Array.isArray(live?.items) ? live.items : null;
  if (!Array.isArray(liveItems)) fail('live_configuration_required');
  const report = [];
  for (const item of items) {
    if (item.metadata.name === WHOLE) continue;
    if (!strings(item.data)) fail('configuration_value_invalid');
    const current = liveItems.find(x => x?.metadata?.name === item.metadata.name) || null;
    const result = merged(current, item);
    const lost = Object.keys(current?.data || {}).filter(key => !Object.hasOwn(result, key));
    if (lost.length) fail('configuration_key_loss');
    const missing = (retained[item.metadata.name] || []).filter(key => !Object.hasOwn(result, key));
    if (missing.length) fail('configuration_retained_key_missing');
    report.push({ name: item.metadata.name, live: Object.keys(current?.data || {}).length,
      rendered: Object.keys(item.data).length, result: Object.keys(result).length });
  }
  return report;
}
module.exports = { retention, merged, WHOLE };
