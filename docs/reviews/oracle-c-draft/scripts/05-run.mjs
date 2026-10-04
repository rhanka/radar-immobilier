#!/usr/bin/env node
// Step 5 — run one model over one frozen set with one prompt version (seats only).
// Usage: node 05-run.mjs --set optim|blind --prompt v1 --model astra|gemini|opus [--concurrency 3]
// Output: runs/<set>/<prompt>/<model>.jsonl (one line per item; resumable: ok items are skipped).
// Blind guard: --set blind requires final-prompt.json naming this prompt (sha256 must match),
// and a model is run on blind only once (an existing ok line is never re-run).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './lib/common.mjs';
import { MODELS, callModel, parseJsonObject } from './lib/models.mjs';

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

if (set === 'blind') {
  const finalFile = path.join(ROOT, 'final-prompt.json');
  if (!fs.existsSync(finalFile)) { console.error('blind refused: no final-prompt.json'); process.exit(3); }
  const fin = JSON.parse(fs.readFileSync(finalFile, 'utf8'));
  if (fin.version !== pv || fin.sha256 !== promptSha) { console.error('blind refused: prompt is not the frozen final prompt'); process.exit(3); }
  if (only) { console.error('blind refused: --only is not allowed on blind'); process.exit(3); }
}

const items = fs.readFileSync(path.join(ROOT, `${set}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const outDir = path.join(ROOT, 'runs', set, pv);
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${model}.jsonl`);
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
    let res; let parsed = null;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      res = await callModel(model, system, user);
      parsed = parseJsonObject(res.text);
    }
    const rec = {
      id: it.id, set, promptVersion: pv, promptSha256: promptSha, model: m.model, effort: m.effort, route: m.route,
      at: new Date().toISOString(), exitCode: res.code, latencyMs: res.latencyMs, usage: res.usage ?? null,
      costUsdApiEquivalent: res.costUsdApiEquivalent ?? null, parsed, rawText: parsed ? undefined : res.text,
      stderrTail: parsed ? undefined : res.stderrTail,
    };
    fs.appendFileSync(outFile, `${JSON.stringify(rec)}\n`);
    parsed ? ok++ : fail++;
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.error(`${set}/${pv}/${model}: ok ${ok}, failed ${fail}`);
