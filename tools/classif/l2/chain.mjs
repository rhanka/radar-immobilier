#!/usr/bin/env node
// make classif-l2-chain ENV=preprod — runs the whole L2 protocol, resumable at every step, meant to
// be launched under `systemd-run --user --slice=h2a-agents.slice` so it survives session restarts:
//   pass 1 independent (G0) → revalidate → complements (scrape) → converge
//   pass 2 reconciliation (G0) → revalidate → converge
//   pass 3 guide amendment G0→G1, residual items re-annotated (G1) → revalidate → converge
//   pass 4 reconciliation (G1), only if needed → revalidate → converge
// Stops as soon as the stop rule holds. Paid calls are never repeated (raw answers reused).
// Progress: $CLASSIF_HOME/l2/chain-status.json and one milestone file per finished pass.
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { classifHome } from '../lib/paths.mjs';
import { runPass } from './run.mjs';
import { main as revalidate } from './revalidate.mjs';
import { main as scrape } from './scrape.mjs';
import { main as converge } from './converge.mjs';
import { main as amend } from './amend.mjs';

const PLAN = { 1: ['independent', 'G0'], 2: ['reconcile', 'G0'], 3: ['independent', 'G1'], 4: ['reconcile', 'G1'] };

export async function main(argv = process.argv.slice(2)) {
  const home = classifHome();
  const concurrency = Number(argv.includes('--concurrency') ? argv[argv.indexOf('--concurrency') + 1] : 2);
  const waitUnit = argv.includes('--wait-unit') ? argv[argv.indexOf('--wait-unit') + 1] : null;
  const statusFile = path.join(home, 'l2', 'chain-status.json');
  const t0 = Date.now();
  const status = (step, extra = {}) => writeFileSync(statusFile, JSON.stringify({ at: new Date().toISOString(), step, minutes: Math.round((Date.now() - t0) / 60000), ...extra }, null, 1), { mode: 0o600 });
  if (waitUnit) {
    status(`waiting for ${waitUnit}`);
    while (spawnSync('systemctl', ['--user', 'is-active', '--quiet', waitUnit]).status === 0) await sleep(30000);
  }
  for (let pass = 1; pass <= 4; pass++) {
    const [mode, guide] = PLAN[pass];
    if (pass === 3 && !existsSync(path.join(home, 'l1', 'pack', 'guide-G1.md'))) {
      status('amend G0→G1 (pass 3)');
      await amend(['--from', 'G0', '--to', 'G1', '--pass', '2']);
    }
    let todo = null;
    let context = new Map();
    if (pass > 1) {
      todo = new Set(JSON.parse(readFileSync(path.join(home, 'l2', `pass${pass}`, 'todo.json'), 'utf8')).items);
      if (mode === 'reconcile') {
        const ctx = JSON.parse(readFileSync(path.join(home, 'l2', `pass${pass}`, 'context.json'), 'utf8'));
        context = new Map(Object.entries(ctx).map(([a, m]) => [a, new Map(Object.entries(m))]));
      }
    }
    status(`pass ${pass} (${mode}, ${guide})`, { todo: todo ? todo.size : 'all' });
    const r = await runPass({ pass, mode, guide, todo, context, concurrency, home });
    status(`revalidate pass ${pass}`, { calls: r.calls });
    await revalidate(['--pass', String(pass)]);
    if (pass === 1) { status('complements (scrape)'); await scrape(); }
    status(`converge pass ${pass}`);
    const report = await converge(['--pass', String(pass)]);
    writeFileSync(path.join(home, 'l2', `pass${pass}.done`), JSON.stringify({ at: new Date().toISOString(), minutes: Math.round((Date.now() - t0) / 60000), stop: report.stop, metrics: report.metrics }), { mode: 0o600 });
    if (report.stop.stop) { status('stopped', { pass, why: report.stop.why }); return report; }
  }
  status('cap reached');
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l2', 'chain.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l2-chain: ${err.stack}\n`); process.exit(1); });
}
