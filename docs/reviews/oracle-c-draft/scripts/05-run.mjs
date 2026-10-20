#!/usr/bin/env node
// Step 5 — run one model over one frozen set with one prompt version (seats only).
// Usage: node 05-run.mjs --set optim|blind --prompt v1 --model astra|gemini|opus [--concurrency 3]
// Output: runs/<set>/<prompt>/<model>.jsonl (one line per item; resumable: ok items are skipped).
// Test guard (--set blind): see TEST-SET-PROTOCOL.md and lib/testset.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './lib/common.mjs';
import { MODELS, callModel, parseJsonObject } from './lib/models.mjs';
import { loadSet, assertTestRunAllowed, audit } from './lib/testset.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const set = arg('set'); const pv = arg('prompt'); const model = arg('model');
const concurrency = Number(arg('concurrency', '3'));
const only = arg('only'); // optional comma-separated ids (debug on optim only)
if (!['optim', 'blind'].includes(set) || !pv || !MODELS[model]) { console.error('bad args'); process.exit(2); }

const promptFile = path.join(ROOT, `prompt-c-${pv}.md`);
const promptMd = fs.readFileSync(promptFile, 'utf8');
const promptSha = crypto.createHash('sha256').update(promptMd).digest('hex');
const between = (a, b) => promptMd.split(`<!-- ${a} -->`)[1].split(`<!-- ${b} -->`)[0].trim();
const system = between('system:start', 'system:end');
const userTpl = between('user:start', 'user:end');

// Test set (blind): sealed, role- and key-gated, prompt frozen in git first, one run per prompt
// and model, every access audited (TEST-SET-PROTOCOL.md).
if (set === 'blind') {
  if (only) { console.error('test run refused: --only is not allowed on the test set'); process.exit(3); }
  try { assertTestRunAllowed({ promptVersion: pv, promptSha256: promptSha, model: MODELS[model]?.model }); } catch (e) { console.error(e.message); process.exit(3); }
}
let items;
try { items = loadSet(set, { purpose: `run ${pv} ${model}`, promptSha256: promptSha }); } catch (e) { console.error(e.message); process.exit(3); }
const setSha = crypto.createHash('sha256').update(items.map((i) => JSON.stringify(i)).join('\n') + '\n').digest('hex');
const outDir = path.join(ROOT, 'runs', set, pv);
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${model}.jsonl`);
if (set === 'blind' && fs.existsSync(outFile)) { console.error('test run refused: a test run file already exists for this prompt and model'); process.exit(3); }
if (set === 'blind') audit({ action: 'test-run', promptVersion: pv, promptSha256: promptSha, model: MODELS[model].model, datasetSha256: setSha });
const done = new Set();
if (fs.existsSync(outFile)) {
  for (const l of fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.parsed) done.add(r.id); }
}
let todo = items.filter((i) => !done.has(i.id));
if (only) { const s = new Set(only.split(',')); todo = todo.filter((i) => s.has(i.id)); }
console.error(`${set}/${pv}/${model}: ${todo.length} to run (${done.size} already ok)`);

const m = MODELS[model];
let next = 0; let ok = 0; let fail = 0;
async function worker() {
  while (next < todo.length) {
    const it = todo[next++];
    const user = userTpl.replace('{{INPUT}}', it.input);
    let res; let parsed = null; let attempts = 0;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      attempts = attempt;
      res = await callModel(model, system, user);
      parsed = parseJsonObject(res.text);
    }
    const rec = {
      id: it.id, set, promptVersion: pv, promptSha256: promptSha, model: m.model, effort: m.effort, route: m.route,
      at: new Date().toISOString(), attempts, datasetSha256: setSha, exitCode: res.code, latencyMs: res.latencyMs, usage: res.usage ?? null,
      costUsdApiEquivalent: res.costUsdApiEquivalent ?? null, parsed, rawText: parsed ? undefined : res.text,
      stderrTail: parsed ? undefined : res.stderrTail,
    };
    fs.appendFileSync(outFile, `${JSON.stringify(rec)}\n`);
    parsed ? ok++ : fail++;
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.error(`${set}/${pv}/${model}: ok ${ok}, failed ${fail}`);
