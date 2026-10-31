#!/usr/bin/env node
// make classif-l0-probe ENV=preprod — 12 route probes (plan §B-L0.4, §D, budget table "L0 probes"):
// 2 calls per model family on SYNTHETIC non-Steve items (one signal, one PV excerpt).
// Reports JSON validity against the expected answer schema, latency, tokens and cost.
import path from 'node:path';
import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ROUTES, callSeat, parseJsonObject } from '../run-seat.mjs';
import { codebookFromMigration } from '../lib/triage.mjs';
import { MIGRATION_CODES, classifHome, privateDir } from '../lib/paths.mjs';
import { MANIFEST_DIR } from '../lib/draw.mjs';
import { sha256 } from '../lib/render.mjs';

const CODES = codebookFromMigration(readFileSync(MIGRATION_CODES, 'utf8'));

// Synthetic items: invented municipality, bylaw, lots and text. No real or Steve data.
export const SYNTHETIC = {
  signal: `Municipalité : municipalite-fictive-probe

[DesignationEvent] event-municipalite-fictive-probe-avis-motion-9999-01
Libellé : Avis de motion — règlement 9999-01 modifiant le règlement de zonage (zone H-999)
Propriétés : date = 2026-05-04 ; étape = avis_motion ; nature = rezonage ; n° règlement = 9999-01 ; zone = H-999
Extraits du document source (verbatim) :
- « Avis de motion est donné qu'à une séance subséquente sera adopté le règlement 9999-01 modifiant le règlement de zonage afin de permettre les habitations multifamiliales de 6 logements dans la zone H-999. »`,
  pv: `Municipalité : municipalite-fictive-probe
Document : procès-verbal du 2026-05-04 (source source-municipalite-fictive-probe-pv-2026-05-04)

PROCÈS-VERBAL de la séance ordinaire du conseil de la Municipalité fictive de Probe, tenue le 4 mai 2026.
1. Ouverture de la séance.
2. Adoption de l'ordre du jour.
3. Avis de motion et dépôt du projet de règlement 9999-01 modifiant le règlement de zonage afin d'autoriser les habitations multifamiliales jusqu'à 6 logements dans la zone H-999.
4. Demande de dérogation mineure, lot 0 000 001 : marge latérale de 1,2 m au lieu de 1,5 m pour un garage détaché. Accordée.
5. Levée de la séance.`,
};

export const SCHEMA = '{"verdict":"pertinent|a_surveiller|non_pertinent","code":"<one reason code>","ambiguous":true|false,"citation":"<verbatim quote from the input>"}';

export function probePrompt(item) {
  return `You classify a municipal regulatory item for a residential densification radar (Québec).
Return ONLY one JSON object, no prose, with this shape: ${SCHEMA}
The verdict must be the partition of the code. Codes (code: verdict): ${CODES.map((c) => `${c.code}: ${c.verdict}`).join('; ')}.
This is a route probe on a synthetic item; answer from the item text only.

ITEM:
${item}`;
}

export function validate(text) {
  const j = parseJsonObject(text);
  if (!j) return { ok: false, why: 'no JSON object' };
  const code = CODES.find((c) => c.code === j.code);
  if (!code) return { ok: false, why: `unknown code ${String(j.code).slice(0, 30)}` };
  if (j.verdict !== code.verdict) return { ok: false, why: 'verdict is not the partition of the code' };
  if (typeof j.ambiguous !== 'boolean') return { ok: false, why: 'ambiguous not boolean' };
  if (typeof j.citation !== 'string' || !j.citation.trim()) return { ok: false, why: 'missing citation' };
  return { ok: true, answer: j };
}

export const PLAN = [
  ['muse-wonder-max', 'signal'], ['muse-wonder-max', 'pv'],
  ['muse-spark-1.3-medium', 'signal'], ['muse-spark-1.3-medium', 'pv'],
  ['opus-5.5-max', 'signal'], ['opus-5.5-medium', 'pv'],
  ['gemini-4-argon-high', 'signal'], ['gemini-4-argon-medium', 'pv'],
  ['mistral-large-4', 'signal'], ['mistral-large-4', 'pv'],
  ['glm-5.3', 'signal'], ['glm-5.3', 'pv'],
];

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
  const plan = only ? PLAN.filter(([r]) => only.includes(r)) : PLAN;
  const home = classifHome();
  const seatTmp = privateDir(path.join(home, 'l0', 'seat-tmp'));
  const results = await pool(plan.map(([label, kind]) => async () => {
    const prompt = probePrompt(SYNTHETIC[kind]);
    const r = await callSeat(label, prompt, { base: seatTmp });
    const v = validate(r.text);
    const route = ROUTES[label];
    return { label, family: route.family, model: route.model, effort: route.effort, route: route.route, item: kind, promptSha256: sha256(prompt),
      exitCode: r.code, latencyMs: r.latencyMs, jsonValid: v.ok, invalidReason: v.ok ? null : v.why, answer: v.ok ? v.answer : null,
      usage: r.usage ?? null, costUsd: r.costUsd ?? r.costUsdApiEquivalent ?? null, effectiveModel: r.effectiveModel ?? null, outcome: r.outcome ?? null,
      textTail: v.ok ? null : String(r.text ?? '').slice(-300), stderrTail: r.code === 0 ? null : r.stderrTail };
  }), 6);
  const report = { lot: 'L0', kind: 'route-probe', createdAt: new Date().toISOString(), calls: results.length, ok: results.filter((r) => r.jsonValid).length, results };
  mkdirSync(MANIFEST_DIR, { recursive: true });
  const name = only ? `probe-report-${only.join('+')}.json` : 'probe-report.json';
  writeFileSync(path.join(MANIFEST_DIR, name), `${JSON.stringify(report, null, 1)}\n`);
  for (const r of results) process.stdout.write(`${r.jsonValid ? 'OK  ' : 'FAIL'} ${r.label.padEnd(24)} ${r.item.padEnd(6)} exit=${r.exitCode} ${Math.round(r.latencyMs / 1000)}s ${r.invalidReason ?? ''}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l0', 'probe.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l0-probe: ${err.message}\n`); process.exit(1); });
}
