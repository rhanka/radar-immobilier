import fs from 'node:fs';
import { home, json, load } from './context.mjs';
const manifest = json(`${home}/request-manifest.json`);
const tally = { started: fs.readFileSync(`${home}/calls.jsonl`, 'utf8').trim().split('\n').length,
  received: 0, checked: 0, nativeAccepted: 0, v9Accepted: 0, accepted: 0, toolEvents: 0, quotaMax: 0 };
for (const p of manifest) {
  const suffix = p.blind ? 'sealed' : 'json';
  if (fs.existsSync(`${home}/responses/${p.key}.${suffix}`)) {
    const r = load(`${home}/responses/${p.key}`, p.blind).result;
    tally.received++; tally.toolEvents += r.toolEvents ?? 0;
    tally.quotaMax = Math.max(tally.quotaMax, r.rateLimits?.primary?.used_percent ?? 0);
  }
  if (!fs.existsSync(`${home}/validated/${p.key}.${suffix}`)) continue;
  const v = load(`${home}/validated/${p.key}`, p.blind);
  tally.checked++; tally.nativeAccepted += Number(v.nativeAccepted ?? false);
  tally.v9Accepted += Number(v.v9Accepted ?? false); tally.accepted += Number(v.accepted);
}
console.log(JSON.stringify(tally));
