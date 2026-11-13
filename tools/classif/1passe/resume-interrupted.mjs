// Only the interrupted document calls. Never imports the D3 dispatcher.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { callSeat, ROUTES, parseJsonObject } from '../run-seat.mjs';
import { sha256 } from '../lib/refc1.mjs';
import { home, split, context, load, save, writePrivate } from './context.mjs';
import { readQuota, seatHome } from './quota.mjs';
const ctx = context(), targets = [], root = `${home}/correction-resume`;
const arms = ['astra-medium', 'opus-5.5-medium'];
for (const arm of arms) for (const d of ctx.manifest.documents) {
  const blind = split.blind.includes(d.id), file = `${home}/annotation/${arm}/${d.id}`;
  if (!fs.existsSync(`${file}.${blind ? 'sealed' : 'json'}`)) continue;
  const previous = load(file, blind);
  if (previous.error === 'execution_interrupted') targets.push({ arm, d, blind, previous, file });
}
for (const [arm, expected] of [['astra-medium', 6], ['opus-5.5-medium', 5]]) {
  const n = targets.filter((t) => t.arm === arm && !t.blind).length;
  assert(n <= expected, 'Unexpected interrupted tuning population');
}
const tuning = targets.filter((t) => !t.blind).map((t) => ({ arm: t.arm, document: t.d.id }));
writePrivate(`${root}/targets-tuning.json`, tuning);
save(`${root}/targets-blind`, targets.filter((t) => t.blind).map((t) => ({ arm: t.arm, document: t.d.id })), true);
console.log(JSON.stringify({ tuning, blindCount: targets.filter((t) => t.blind).length, concurrency: 10 }));
const promptBase = fs.readFileSync('tools/classif/1passe/annotation-prompt.md', 'utf8');
ROUTES['astra-medium'].build = (d, f, p) => ({ cmd: 'codex', args: ['exec', '-m', 'gpt-6-astra', '-c',
  'model_reasoning_effort=medium', '-s', 'read-only', '--skip-git-repo-check', '--json', '-o', path.join(d, 'last-message.md'), '-'],
stdin: p, env: { CODEX_HOME: seatHome } });
const opus = ROUTES['opus-5.5-medium'].build;
ROUTES['opus-5.5-medium'].build = (...args) => {
  const b = opus(...args); b.args.push('--safe-mode', '--disable-slash-commands', '--max-turns', '1'); return b;
};
let next = 0, quotaPromise, stopCodex = false, stopAll = false;
const quotas = [], children = new Set(), outcomes = [];
async function quota() {
  quotaPromise ??= readQuota().then((q) => {
    quotas.push(q);
    const values = [q.rateLimits?.primary?.usedPercent, q.rateLimits?.secondary?.usedPercent].filter((n) => typeof n === 'number');
    if (!values.length || Math.max(...values) >= 90 || q.ordinaryUsageAllowed === false) stopCodex = true;
    return q;
  }).catch(() => { stopCodex = true; }).finally(() => { quotaPromise = null; });
  await quotaPromise;
  if (stopCodex) for (const c of children) if (c.arm === 'astra-medium') {
    try { process.kill(-c.pid, 'SIGTERM'); } catch { /* already closed */ }
  }
}
await quota();
const timer = setInterval(() => { void quota(); }, 60000);
try {
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (next < targets.length && !stopAll) {
      const t = targets[next++], { arm, d, blind, previous, file } = t;
      const receipt = `${root}/${arm}/${d.id}`, ext = blind ? 'sealed' : 'json';
      if (fs.existsSync(`${receipt}.intent.${ext}`)) continue;
      if (arm === 'astra-medium') { await quota(); if (stopCodex) continue; }
      const prompt = `${promptBase}\n\n${ctx.pack}\n\nDOCUMENT INTÉGRAL\n${ctx.texts.get(d.id)}`;
      assert.equal(sha256(prompt), previous.promptSha256, 'Prompt must stay byte identical');
      save(`${receipt}.previous`, previous, blind);
      const intent = { at: new Date().toISOString(), arm, document: d.id, blind, promptSha256: sha256(prompt), attempt: 'targeted-resume' };
      save(`${receipt}.intent`, intent, blind);
      const result = await callSeat(arm, prompt, { spawnImpl: (...args) => {
        const p = spawn(...args); p.arm = arm; children.add(p); p.on('close', () => children.delete(p)); return p;
      } }).catch(() => ({ code: -1, transportFailure: true }));
      const failed = result.code !== 0 || result.isError || result.errorEnvelope || !result.text || result.toolEvents;
      const message = failed ? `${result.stderrTail ?? ''} ${result.errorEnvelope ?? ''} ${result.stdoutTail ?? ''}` : '';
      const hard = /\b(401|403)\b|disabled|deactivated|access.{0,20}denied/i.test(message);
      const limited = /\b(402|429)\b|quota|rate.?limit|usage.?limit/i.test(message);
      if (hard) stopAll = true;
      if (arm === 'astra-medium' && (result.rateLimits?.primary?.used_percent ?? 0) >= 90) stopCodex = true;
      const parsed = !failed ? parseJsonObject(result.text) : null;
      const answer = { ...intent, finishedAt: new Date().toISOString(), valid: Array.isArray(parsed?.acts),
        acts: Array.isArray(parsed?.acts) ? parsed.acts : [], error: hard ? 'refus_compte' : limited ? 'quota' : failed ? 'execution_failure' : !Array.isArray(parsed?.acts) ? 'invalid_output' : null };
      save(`${receipt}.result`, { ...answer, result }, blind);
      save(file, answer, blind);
      outcomes.push({ arm, blind, valid: answer.valid, error: answer.error });
      writePrivate(`${root}/progress.json`, { completed: outcomes.length, outcomes, stopCodex, stopAll });
      console.log(JSON.stringify({ completed: outcomes.length, arm, blind, valid: answer.valid, error: answer.error }));
    }
  }));
} finally { clearInterval(timer); await quota(); }
const summary = { at: new Date().toISOString(), targets: targets.length, calls: outcomes.length,
  outcomes, quotas, stopCodex, stopAll, d3Calls: 0, concurrency: 10 };
writePrivate(`${root}/summary.json`, summary);
console.log(JSON.stringify(summary));
