import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { callSeat, ROUTES } from '../../run-seat.mjs';
import { sha256 } from '../../lib/refc1.mjs';
import { dir, home, freeze, save, write, audit, json } from './context.mjs';
import { seatHome, readQuota } from './quota.mjs';
execFileSync('git', ['ls-files', '--error-unmatch', `${dir}/freeze.json`]);
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', dir]);
const requests = json(`${home}/request-manifest.json`);
assert.equal(requests.length, freeze.chunkCount);
assert.equal(sha256(JSON.stringify(json(`${home}/proofs.json`))), freeze.requestManifestSha256);
const journal = `${home}/calls.jsonl`;
const prior = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const seen = new Set(prior.map((r) => r.key));
const started = prior[0]?.at ?? new Date().toISOString();
let stopped = null, next = 0, completed = 0;
const quotas = fs.existsSync(`${home}/quotas.json`) ? json(`${home}/quotas.json`) : [];
async function quota() {
  const q = await readQuota(); quotas.push(q); write(`${home}/quotas.json`, quotas);
  const windows = [q.rateLimits?.primary, q.rateLimits?.secondary].filter(Boolean);
  if (!windows.length || windows.some((w) => typeof w.usedPercent !== 'number' || w.usedPercent >= 90)
    || q.ordinaryUsageAllowed === false) stopped = 'quota';
  return q;
}
await quota();
console.log(JSON.stringify({ action: 'start', calls: requests.length, stopped, quota: quotas.at(-1) }));
const timer = setInterval(() => quota().catch(() => { stopped = 'quota_unavailable'; }), 600000);
ROUTES['astra-low'].build = (cwd, file, input) => ({ cmd: 'codex',
  args: ['exec', '-m', freeze.model.model, '-c', `model_reasoning_effort=${freeze.model.effort}`, '-s', 'read-only',
    '--skip-git-repo-check', '--json', '-o', path.join(cwd, 'last-message.md'), '-'],
  stdin: input, env: { CODEX_HOME: seatHome } });
audit({ action: 'run', requestManifestSha256: freeze.requestManifestSha256, model: freeze.model,
  oneShot: true, priorStarts: prior.length, concurrency: 10 });
try {
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (!stopped && next < requests.length) {
      const item = requests[next++];
      if (seen.has(item.key)) continue;
      const request = json(`${home}/requests/${item.key}.json`);
      assert.equal(sha256(request.input), item.inputSha256);
      const intent = { at: new Date().toISOString(), ...item };
      fs.appendFileSync(journal, JSON.stringify(intent) + '\n', { mode: 0o600 });
      const result = await callSeat('astra-low', request.input).catch(() => ({ code: -1, errorEnvelope: 'transport_failure' }));
      save(`${home}/responses/${item.key}`, { ...intent, finished: new Date().toISOString(), result }, item.blind);
      const error = `${result.errorEnvelope ?? ''} ${result.code ? result.stderrTail ?? '' : ''}`;
      if (result.authError || /\b(401|403)\b|disabled|\bterms\b|account.{0,30}(suspend|refus)/i.test(error)) stopped = 'account_refusal';
      if (/\b(402|429)\b|quota|rate.?limit/i.test(error)) stopped = 'quota_failure';
      const limits = result.rateLimits;
      if ([limits?.primary, limits?.secondary].some((w) => (w?.used_percent ?? w?.usedPercent ?? 0) >= 90)) stopped = 'quota';
      completed++;
      console.log(JSON.stringify({ completed, total: requests.length, stopped }));
    }
  }));
} finally {
  clearInterval(timer);
  await quota().catch(() => { stopped ??= 'final_quota_unavailable'; });
  const finished = new Date().toISOString();
  write(`${home}/run-summary.json`, { started, finished, durationSeconds: (Date.parse(finished) - Date.parse(started)) / 1000,
    calls: fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').length : 0, completed, stopped, quotas });
}
