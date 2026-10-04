#!/usr/bin/env node
// Re-scores every archived run (no model call) into results/score-*.{json,md}.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const JOBS = [
  ['optim', 'v1', null], ['optim', 'v2', null], ['blind', 'v2', null], ['blind', 'v2', 'sens-non-donne'],
];
for (const [set, pv, ex] of JOBS) {
  const base = path.join(ROOT, 'results', `score-${set}-${pv}${ex ? `-excl-${ex}` : ''}`);
  const args = [path.join(here, '06-score.mjs'), '--set', set, '--prompt', pv, '--json', `${base}.json`, '--md', `${base}.md`];
  if (ex) args.push('--exclude', ex);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  console.log(`${path.basename(base)}: ok`);
}
