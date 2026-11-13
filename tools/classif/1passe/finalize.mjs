import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sha256, MAGIC } from '../lib/refc1.mjs';
import { dir, home, split, load, save, writePrivate, context } from './context.mjs';
context();
const annotation = JSON.parse(fs.readFileSync(`${home}/annotation/run-summary.json`, 'utf8'));
const arbitration = JSON.parse(fs.readFileSync(`${home}/arbitration/run-summary.json`, 'utf8'));
const initial = JSON.parse(fs.readFileSync(`${home}/reference/agreement.json`, 'utf8'));
const rows = [...load(`${home}/reference/tuning-prepared`, false), ...load(`${home}/reference/blind-prepared`, true)];
const counts = { resolved: 0, fallback: 0, not_attempted: 0 }, causes = {};
for (const r of rows) {
  if (r.disputed) {
    r.arbitration = load(`${home}/arbitration/${r.id.replaceAll('#', '_')}`, r.blind);
    r.finalClass = r.arbitration.finalClass;
    counts[r.arbitration.status]++;
    if (r.arbitration.cause) causes[r.arbitration.cause] = (causes[r.arbitration.cause] ?? 0) + 1;
  }
  r.shown = r.finalClass !== 'N';
}
assert.equal(rows.length, 676);
const halves = Object.fromEntries(['tuning', 'blind'].map((half) => {
  const part = rows.filter((r) => r.blind === (half === 'blind'));
  return [half, { PV: 50, acts: part.length, classes: Object.fromEntries(['P', 'S', 'Non classé', 'N'].map((c) => [c, part.filter((r) => r.finalClass === c).length])),
    neutral: split.summary[half].neutral, shown: part.filter((r) => r.shown).length }];
}));
const referenceHashes = {
  tuning: save(`${home}/reference/tuning-final`, rows.filter((r) => !r.blind), false),
  blind: save(`${home}/reference/blind-final`, rows.filter((r) => r.blind), true),
};
const sample = rows.filter((r) => !r.blind && r.disputed).sort((a, b) =>
  Number(a.arbitration.status === 'resolved') - Number(b.arbitration.status === 'resolved') ||
  sha256(`${split.seed}|${a.id}`).localeCompare(sha256(`${split.seed}|${b.id}`))).slice(0, 20);
writePrivate(`${home}/reference/owner-sample.json`, sample);
writePrivate(`${home}/reference/owner-sample.md`, `# Échantillon owner — mise au point seule\n\n` + sample.map((r) =>
  `## ${r.id}\n\n${r.unit.label}\n\nSource : ${r.unit.sourceUrl}\n\nCitation B : ${r.unit.citation}\n\n` +
  r.votes.map((v, i) => `Avis ${i + 1} : ${v.code ?? 'absent'} ; valide : ${v.valid}. ${v.reason ?? ''}\n\nCitation : ${v.quote ?? 'absente'}`).join('\n\n') +
  `\n\nD3 : ${r.arbitration.status}. Classe : ${r.finalClass}. Cause : ${r.arbitration.cause ?? 'aucune'}.\n\n${r.arbitration.answer?.reason ?? ''}`
).join('\n\n'));
const arms = {};
let resumeAt = null;
for (const arm of ['astra-medium', 'opus-5.5-medium']) {
  const errors = {}, latencies = [], quotas = [];
  for (const id of [...split.tuning, ...split.blind]) {
    const blind = split.blind.includes(id), file = `${home}/annotation/${arm}/${id}`;
    const ext = blind ? 'sealed' : 'json';
    if (!fs.existsSync(`${file}.${ext}`)) { errors.missing_annotation = (errors.missing_annotation ?? 0) + 1; continue; }
    const r = load(file, blind);
    if (r.error) errors[r.error] = (errors[r.error] ?? 0) + 1;
    if (r.error === 'execution_interrupted') resumeAt ??= r.finishedAt;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!fs.existsSync(`${file}.attempt-${attempt}.${ext}`)) continue;
      const a = load(`${file}.attempt-${attempt}`, blind);
      if (a.result?.latencyMs) latencies.push(a.result.latencyMs);
      if (a.result?.rateLimits) quotas.push(a.result.rateLimits);
    }
  }
  arms[arm] = { ...annotation.arms[arm], errors, received: latencies.length,
    sumLatencyMs: latencies.reduce((a, b) => a + b, 0),
    quotaTelemetryResponses: quotas.length };
}
const artifacts = [];
function audit(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const f = path.join(folder, entry.name);
    if (entry.isDirectory()) audit(f);
    else {
      const bytes = fs.readFileSync(f);
      if (entry.name.endsWith('.sealed')) assert(bytes.subarray(0, 5).equals(MAGIC));
      artifacts.push(`${path.relative(home, f)}|${sha256(bytes)}`);
    }
  }
}
for (const folder of ['annotation', 'arbitration', 'reference']) audit(`${home}/${folder}`);
const result = { at: new Date().toISOString(), annotation: { started: annotation.started, finished: annotation.finished, resumeAt,
  wallSeconds: (Date.parse(annotation.finished) - Date.parse(annotation.started)) / 1000,
  resumedSeconds: resumeAt ? (Date.parse(annotation.finished) - Date.parse(resumeAt)) / 1000 : null,
  arms, retries: annotation.retries, quotas: annotation.quotas,
  claudeQuota: { before: 'Non mesuré par la lane précédente ; aucune reconstruction.',
    after: fs.existsSync(`${home}/annotation/claude-quota-after.json`) ? JSON.parse(fs.readFileSync(`${home}/annotation/claude-quota-after.json`, 'utf8')) : null } },
  agreement: initial.agreement, validationIssues: initial.validationIssues, disputes: initial.disputes,
  arbitration: { ...arbitration, outcomes: counts, causes }, halves, referenceHashes,
  ownerSample: { count: sample.length, blindActs: 0, resolved: sample.filter((r) => r.arbitration.status === 'resolved').length,
    sha256: sha256(fs.readFileSync(`${home}/reference/owner-sample.json`)) },
  privateArtifactCount: artifacts.length, privateTreeSha256: sha256(artifacts.sort().join('\n')),
  newInventory: initial.newInventory,
  incidents: ['16 appels interrompus par la lane précédente, sans rejeu.',
    'La reprise a démarré avant son commit : échec du staging Git, puis commit après escalade. Écart de séquencement déclaré.',
    'Le découpage est stratifié sur B, pas sur les classes C.',
    'Les inventaires hors B restent privés et hors du support D1.'],
  next: 'Passe unique, itération 1. Aucun lancement dans cette lane.' };
fs.writeFileSync(`${dir}/results.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
