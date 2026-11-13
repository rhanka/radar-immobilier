import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { callSeat, ROUTES, parseJsonObject } from '../run-seat.mjs';
import { sha256 } from '../lib/refc1.mjs';
import { dir, home, split, context, save, load, writePrivate } from './context.mjs';
import { readQuota, seatHome } from './quota.mjs';
const ctx = context(), resumed = new Date().toISOString();
const promptBase = fs.readFileSync(`${dir}/annotation-prompt.md`, 'utf8');
const arms = ['astra-medium', 'opus-5.5-medium'];
const states = Object.fromEntries(arms.map((a) => [a, { calls: 0, completed: 0, stopped: null, children: new Set(), pauseUntil: 0 }]));
fs.mkdirSync(`${home}/annotation`, { recursive: true, mode: 0o700 });
const journal = `${home}/annotation/calls.jsonl`;
const prior = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const started = prior[0]?.at ?? resumed;
let retries = prior.filter((r) => r.attempt > 0).length, quotaPromise;
const quotas = fs.existsSync(`${home}/annotation/quotas.json`) ? JSON.parse(fs.readFileSync(`${home}/annotation/quotas.json`, 'utf8')) : [];
// Un appel interrompu reste facturé au budget. Aucun rejeu de sa réponse absente.
for (const intent of prior) {
  const file = `${home}/annotation/${intent.arm}/${intent.document}`;
  const ext = intent.blind ? 'sealed' : 'json';
  if (!fs.existsSync(`${file}.${ext}`)) {
    const attemptFile = `${file}.attempt-${intent.attempt}`;
    const r = fs.existsSync(`${attemptFile}.${ext}`) ? load(attemptFile, intent.blind) : null;
    if (!r?.limited) save(file, { ...intent, finishedAt: resumed, valid: false, acts: [], error: 'execution_interrupted' }, intent.blind);
  }
}
for (const arm of arms) {
  states[arm].calls = prior.filter((r) => r.arm === arm).length;
  for (const d of ctx.manifest.documents) {
    const blind = split.blind.includes(d.id), file = `${home}/annotation/${arm}/${d.id}`;
    if (fs.existsSync(`${file}.${blind ? 'sealed' : 'json'}`)) {
      states[arm].completed++;
      if (load(file, blind).error === 'refus_compte') states[arm].stopped = 'refus_compte';
    }
  }
}
async function quota() {
  quotaPromise ??= readQuota().then((q) => { quotas.push(q); writePrivate(`${home}/annotation/quotas.json`, quotas); return q; }).finally(() => { quotaPromise = null; });
  const q = await quotaPromise;
  const used = q.rateLimits?.primary?.usedPercent;
  if (typeof used !== 'number' || used >= 90 || q.ordinaryUsageAllowed === false) states['astra-medium'].stopped = 'quota_codex';
  return q;
}
await quota();
const timer = setInterval(() => quota().catch(() => { states['astra-medium'].stopped = 'quota_indisponible'; }), 600000);
ROUTES['astra-medium'].build = (d, f, p) => {
  // Même surface que le pilote, home local autorisé, sans charger le home global.
  return { cmd: 'codex', args: ['exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort=medium', '-s', 'read-only', '--skip-git-repo-check', '--json', '-o', path.join(d, 'last-message.md'), '-'], stdin: p, env: { CODEX_HOME: seatHome } };
};
const opus = ROUTES['opus-5.5-medium'].build;
ROUTES['opus-5.5-medium'].build = (...args) => {
  const b = opus(...args); b.args.push('--safe-mode', '--disable-slash-commands', '--max-turns', '1'); return b;
};
function stop(arm, why) {
  const s = states[arm]; s.stopped = why;
  for (const p of s.children) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* déjà terminé */ } }
}
async function run(arm) {
  const s = states[arm];
  let next = 0;
  const docs = [...ctx.manifest.documents].sort((a,b) => a.id.localeCompare(b.id));
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (!s.stopped && next < docs.length) {
      const d = docs[next++], blind = split.blind.includes(d.id);
      const file = `${home}/annotation/${arm}/${d.id}`;
      if (fs.existsSync(`${file}.${blind ? 'sealed' : 'json'}`)) continue;
      const prompt = `${promptBase}\n\n${ctx.pack}\n\nDOCUMENT INTÉGRAL\n${ctx.texts.get(d.id)}`;
      for (let attempt = 0; attempt < 3 && !s.stopped; attempt++) {
        while (Date.now() < s.pauseUntil && !s.stopped) await delay(Math.min(1000, s.pauseUntil - Date.now()));
        if (s.stopped) break;
        if (Object.values(states).reduce((n, x) => n + x.calls, 0) >= 240) { stop(arm, 'budget'); break; }
        s.calls++;
        const intent = { at: new Date().toISOString(), arm, document: d.id, attempt, promptSha256: sha256(prompt), blind };
        fs.appendFileSync(`${home}/annotation/calls.jsonl`, `${JSON.stringify(intent)}\n`, { mode: 0o600 });
        const result = await callSeat(arm, prompt, { spawnImpl: (...args) => {
          const p = spawn(...args); s.children.add(p); p.on('close', () => s.children.delete(p)); return p;
        } }).catch(() => ({ code: -1, transportFailure: true }));
        const error = result.code !== 0 || result.isError || result.errorEnvelope || !result.text;
        const message = error ? `${result.stderrTail ?? ''} ${result.errorEnvelope ?? ''} ${result.stdoutTail ?? ''} ${result.text ?? ''}` : '';
        const hard = /\b(401|403)\b|disabled|\bterms\b|deactivated|account.{0,30}(suspend|refus)|access.{0,20}denied/i.test(message);
        const limited = !hard && /\b(402|429)\b|quota|rate.?limit|too many requests|usage.?limit/i.test(message);
        save(`${file}.attempt-${attempt}`, { ...intent, result, error, hard, limited }, blind);
        if (hard) stop(arm, 'refus_compte');
        if (limited && attempt < 2 && retries < 40) { retries++; s.pauseUntil = Date.now() + (attempt ? 300000 : 60000); continue; }
        const parsed = !error && !result.toolEvents ? parseJsonObject(result.text) : null;
        const answer = { ...intent, finishedAt: new Date().toISOString(), valid: Array.isArray(parsed?.acts), acts: parsed?.acts ?? [], error: hard ? 'refus_compte' : limited ? 'quota' : error ? 'execution_failure' : !parsed?.acts ? 'invalid_output' : null };
        save(file, answer, blind); s.completed++;
        if (arm === 'astra-medium' && (result.rateLimits?.primary?.used_percent ?? 0) >= 90) stop(arm, 'quota_codex');
        if (limited) stop(arm, 'quota_reprises_epuisees');
        console.log(JSON.stringify({ arm, completed: s.completed, calls: s.calls, stopped: s.stopped }));
        break;
      }
    }
  }));
}
fs.mkdirSync(`${home}/annotation`, { recursive: true, mode: 0o700 });
await Promise.all(arms.map(run));
clearInterval(timer); await quota().catch(() => {});
const summary = { started, finished: new Date().toISOString(), retries, arms: Object.fromEntries(arms.map((a) => [a, { calls: states[a].calls, completed: states[a].completed, stopped: states[a].stopped }])), quotas };
writePrivate(`${home}/annotation/run-summary.json`, summary);
console.log(JSON.stringify(summary));
