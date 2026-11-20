import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { callSeat, parseJsonObject } from '../run-seat.mjs';
import { sha256 } from '../lib/refc1.mjs';
import { dir, home, split, context, load, save, writePrivate } from './context.mjs';
import { codesFrom } from './matching.mjs';
const ctx = context(), codes = codesFrom(ctx.pack);
const base = fs.readFileSync(`${dir}/arbitration-prompt.md`, 'utf8');
const rows = [...load(`${home}/reference/tuning-prepared`, false), ...load(`${home}/reference/blind-prepared`, true)];
const disputes = rows.filter((r) => r.disputed).sort((a, b) => Number(a.blind) - Number(b.blind) || sha256(`${split.seed}|${a.id}`).localeCompare(sha256(`${split.seed}|${b.id}`)));
const annotation = JSON.parse(fs.readFileSync(`${home}/annotation/run-summary.json`, 'utf8'));
const arbDir = `${home}/arbitration`;
const existing = fs.existsSync(arbDir) ? fs.readdirSync(arbDir) : [];
const intents = existing.filter((n) => n.includes('.intent-')).map((n) => load(`${arbDir}/${n.replace(/\.(json|sealed)$/, '')}`, n.endsWith('.sealed')));
let calls = intents.length, retries = annotation.retries + intents.filter((r) => r.attempt > 0).length, stopped = null;
const started = intents.map((r) => r.at).sort()[0] ?? new Date().toISOString();
// Reprise durable : ni rejeu d’un appel coupé, ni remise à zéro du budget.
for (const row of disputes) {
  const file = `${arbDir}/${row.id.replaceAll('#', '_')}`;
  const ext = row.blind ? 'sealed' : 'json';
  if (fs.existsSync(`${file}.${ext}`)) {
    const previous = load(file, row.blind);
    if (previous.cause === 'refus_compte') stopped = 'refus_compte';
    continue;
  }
  const prior = intents.filter((r) => r.id === row.id);
  if (!prior.length) continue;
  const last = prior.sort((a, b) => b.attempt - a.attempt)[0];
  const attemptFile = `${file}.attempt-${last.attempt}`;
  const record = fs.existsSync(`${attemptFile}.${ext}`) ? load(attemptFile, row.blind) : null;
  if (record?.hard) stopped = 'refus_compte';
  save(file, { id: row.id, status: 'fallback', finalClass: 'Non classé', shown: true,
    cause: record?.hard ? 'refus_compte' : 'execution_interrupted' }, row.blind);
}
for (const row of disputes) {
  const file = `${home}/arbitration/${row.id.replaceAll('#', '_')}`;
  if (fs.existsSync(`${file}.${row.blind ? 'sealed' : 'json'}`)) continue;
  let outcome = { id: row.id, status: 'not_attempted', finalClass: 'Non classé', shown: true, cause: stopped };
  if (!stopped && calls < 776) {
    const act = { object: row.unit.label, stage: row.unit.stage, quote: row.unit.citation, page: row.unit.page };
    const opinions = row.votes.map((v) => ({ code: v.valid ? v.code : null, quote: v.quote ?? '', reason: v.reason ?? '', issues: v.issues }));
    // Aucune provenance de B, aucun nom d’annotateur, aucun résultat candidat.
    const prompt = `${base}\n\n${ctx.pack}\n\nACTE À ARBITRER\n${JSON.stringify(act)}\nAVIS A ET B\n${JSON.stringify(opinions)}\nDOCUMENT INTÉGRAL\n${ctx.texts.get(row.document)}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      calls++;
      const intent = { at: new Date().toISOString(), id: row.id, attempt, promptSha256: sha256(prompt), blind: row.blind };
      fs.mkdirSync(`${home}/arbitration`, { recursive: true, mode: 0o700 });
      // Le journal détaillé aveugle reste scellé, comme les réponses.
      save(`${file}.intent-${attempt}`, intent, row.blind);
      const result = await callSeat('gemini-4-argon-high', prompt).catch(() => ({ code: -1, transportFailure: true }));
      const failed = result.code !== 0 || result.isError || result.errorEnvelope || !result.text;
      const message = failed ? `${result.stderrTail ?? ''} ${result.errorEnvelope ?? ''} ${result.stdoutTail ?? ''} ${result.text ?? ''}` : '';
      const hard = /\b(401|403)\b|disabled|\bterms\b|deactivated|account.{0,30}(suspend|refus)|access.{0,20}denied/i.test(message);
      const limited = !hard && /\b(402|429)\b|quota|rate.?limit|too many requests|usage.?limit/i.test(message);
      save(`${file}.attempt-${attempt}`, { ...intent, result, hard, limited }, row.blind);
      if (hard) stopped = 'refus_compte';
      if (limited && attempt < 2 && retries < 40 && calls < 776) { retries++; await delay(attempt ? 300000 : 60000); continue; }
      const a = !failed && !result.toolEvents ? parseJsonObject(result.text) : null;
      const valid = a?.unresolved === false && codes.has(a.code) && typeof a.quote === 'string' && a.quote.trim().length > 0 && a.quote.length <= 300 && ctx.texts.get(row.document).includes(a.quote) && typeof a.reason === 'string' && a.reason.trim().length > 0 && a.reason.trim().split(/\s+/).length <= 40;
      outcome = { id: row.id, status: valid ? 'resolved' : 'fallback', finalClass: valid ? codes.get(a.code) : 'Non classé',
        answer: a, shown: valid ? codes.get(a.code) !== 'N' : true,
        cause: hard ? 'refus_compte' : limited ? 'quota' : failed ? 'execution_failure' : valid ? null : 'residual_disagreement' };
      if (limited) stopped = 'quota_reprises_epuisees';
      break;
    }
  }
  save(file, outcome, row.blind);
  console.log(JSON.stringify({ completed: disputes.indexOf(row) + 1, total: disputes.length, calls, stopped }));
}
writePrivate(`${home}/arbitration/run-summary.json`, { started, finished: new Date().toISOString(), calls, retries: retries - annotation.retries, stopped, disputes: disputes.length });
