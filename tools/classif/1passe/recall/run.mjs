import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { callSeat, ROUTES, parseJsonObject } from '../../run-seat.mjs';
import { sha256 } from '../../lib/refc1.mjs';
import { dir, home, freeze, documents, save, write, audit, json } from './context.mjs';
import { seatHome, readQuota } from './quota.mjs';
const prompt = fs.readFileSync(`${dir}/prompt.md`, 'utf8');
assert.equal(sha256(prompt), freeze.promptSha256);
execFileSync('git', ['ls-files', '--error-unmatch', `${dir}/prompt.md`]);
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', `${dir}/prompt.md`, `${dir}/freeze.json`]);
const docs = documents().sort((a, b) => a.id.localeCompare(b.id));
assert.equal(docs.length, 100);
fs.mkdirSync(`${home}/responses`, { recursive: true, mode: 0o700 });
const journal = `${home}/calls.jsonl`;
const prior = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const seen = new Set(prior.map((r) => r.document));
const started = prior[0]?.at ?? new Date().toISOString();
let stopped = null, next = 0, completed = 0;
const quotas = fs.existsSync(`${home}/quotas.json`) ? json(`${home}/quotas.json`) : [];
async function quota() {
  const q = await readQuota(); quotas.push(q); write(`${home}/quotas.json`, quotas);
  const used = q.rateLimits?.primary?.usedPercent;
  if (typeof used !== 'number' || used >= 90 || q.ordinaryUsageAllowed === false) stopped = 'quota';
  return q;
}
await quota();
const timer = setInterval(() => quota().catch(() => { stopped = 'quota_unavailable'; }), 600000);
ROUTES['astra-low'].build = (cwd, file, input) => ({ cmd: 'codex',
  args: ['exec', '-m', freeze.model, '-c', 'model_reasoning_effort=low', '-s', 'read-only',
    '--skip-git-repo-check', '--json', '-o', path.join(cwd, 'last-message.md'), '-'],
  stdin: input, env: { CODEX_HOME: seatHome } });
audit({ action: 'run', promptSha256: freeze.promptSha256, model: freeze.model, effort: freeze.effort,
  oneShot: true, priorStarts: prior.length, concurrency: 10 });
try {
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (!stopped && next < docs.length) {
      const d = docs[next++];
      if (seen.has(d.id)) continue; // An interrupted call remains a failure, never replayed.
      const input = `${prompt}\n\nDOCUMENT INTÉGRAL\n${d.text}`;
      const intent = { at: new Date().toISOString(), document: d.id, blind: d.blind,
        promptSha256: freeze.promptSha256, inputSha256: sha256(input), textSha256: d.textSha256 };
      fs.appendFileSync(journal, JSON.stringify(intent) + '\n', { mode: 0o600 });
      const result = await callSeat('astra-low', input).catch(() => ({ code: -1, errorEnvelope: 'transport_failure' }));
      // Seal the entire answer immediately; no blind text or per-act result reaches stdout.
      save(`${home}/responses/${d.id}`, { ...intent, finished: new Date().toISOString(), result }, d.blind);
      const error = `${result.errorEnvelope ?? ''} ${result.code ? result.stderrTail ?? '' : ''}`;
      if (result.authError || /\b(401|403)\b|disabled|\bterms\b|account.{0,30}(suspend|refus)/i.test(error)) stopped = 'account_refusal';
      if (/\b(402|429)\b|quota|rate.?limit/i.test(error)) stopped = 'quota_failure';
      if ((result.rateLimits?.primary?.used_percent ?? 0) >= 90) stopped = 'quota';
      completed++;
      console.log(JSON.stringify({ completed, total: 100, stopped }));
    }
  }));
} finally {
  clearInterval(timer);
  await quota().catch(() => { stopped ??= 'final_quota_unavailable'; });
  const finished = new Date().toISOString();
  write(`${home}/run-summary.json`, { started, finished, durationSeconds: (Date.parse(finished) - Date.parse(started)) / 1000,
    calls: fs.readFileSync(journal, 'utf8').trim().split('\n').length, completed, stopped, quotas });
}
