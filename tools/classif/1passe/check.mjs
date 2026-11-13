// Contrôle d’intégrité hors ligne. Aucun appel de siège, aucune ouverture de l’aveugle.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { sha256, MAGIC } from '../lib/refc1.mjs';
import { ROUTES } from '../run-seat.mjs';

const dir = 'tools/classif/1passe';
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
const split = json(`${dir}/split.json`);
const annotation = json(`${dir}/annotation.json`);
const singlepass = json(`${dir}/singlepass.json`);
const routes = json(`${dir}/routes.json`);
const seed = json(`${dir}/seed.json`);
assert.equal(split.seed, seed.seed);
assert.equal(split.tuning.length, 50);
assert.equal(split.blind.length, 50);
assert.equal(new Set([...split.tuning, ...split.blind]).size, 100);
for (const half of ['tuning', 'blind']) {
  assert.equal(split[`${half}IdsSha256`], sha256(`${split[half].join('\n')}\n`));
  assert.equal(split.summary[half].cShownActs, null);
}
for (const [file, hash] of Object.entries(split.sources)) {
  assert.equal(sha256(readFileSync(`/private/source/${file}`)), hash);
}
const oracle = json('/private/source/consensus.json');
const neutral = json('/private/source/unresolved.json');
const corpus = json('/private/source/manifest.json');
assert.equal(oracle.units.length, 676);
assert.equal(new Set(oracle.units.map((u) => u.id)).size, 676);
assert.equal(neutral.entries.length, 43);
assert.equal(new Set(oracle.units.map((u) => u.documentId)).size, 93);
assert.equal(corpus.documents.length, 100);
assert.equal(new Set(corpus.documents.map((d) => d.city)).size, 100);
const drawn = { tuning: [], blind: [] };
const present = new Set(oracle.units.map((u) => u.documentId));
for (const stratum of [true, false]) {
  const docs = corpus.documents.filter((d) => present.has(d.id) === stratum)
    .sort((a, b) => sha256(`${seed.seed}|${a.id}`).localeCompare(sha256(`${seed.seed}|${b.id}`)));
  const offset = drawn.tuning.length > drawn.blind.length ? 1 : 0;
  docs.forEach((d, i) => drawn[(i + offset) % 2 ? 'blind' : 'tuning'].push(d.id));
}
for (const half of ['tuning', 'blind']) {
  assert.deepEqual(drawn[half].sort(), split[half]);
  assert.equal(oracle.units.filter((u) => split[half].includes(u.documentId)).length, split.summary[half].bActs);
  assert.equal(neutral.entries.filter((u) => split[half].includes(u.documentId)).length, split.summary[half].neutral);
}
const sealed = readFileSync('/private/blind/blind.sealed');
assert(sealed.subarray(0, 5).equals(MAGIC));
assert.equal(sha256(sealed), split.blindSeal.sealedSha256);
assert.equal(statSync('/private/blind/blind.sealed').mode & 0o077, 0);
assert.equal(statSync('/private/custody/blind-key.base64').mode & 0o077, 0);
const tuningHash = sha256(readFileSync('/private/tuning.jsonl'));
if (process.argv.includes('--freeze') && !split.tuningDataSha256) {
  split.tuningDataSha256 = tuningHash;
  writeFileSync(`${dir}/split.json`, `${JSON.stringify(split)}\n`);
}
assert.equal(tuningHash, split.tuningDataSha256);
for (const [file, hash] of Object.entries(annotation.pack)) {
  assert.equal(sha256(readFileSync(`/pack/${file}`)), hash);
}
assert.deepEqual(annotation.iteration, ['astra-medium', 'opus-5.5-medium']);
assert.deepEqual(annotation.arbitration.iteration, ['gemini-4-argon-high']);
assert(singlepass.iterations.every((it) => it.length <= 2));
for (const route of routes.routes) {
  assert.equal(ROUTES[route.id].model, route.model);
  assert.equal(ROUTES[route.id].effort, route.effort);
  assert.equal(route.concurrency, ['astra-medium', 'opus-5.5-medium'].includes(route.id) ? 8 : 1);
}
assert.equal(routes.globalConcurrency, 16);
assert.equal(routes.arbitrationConcurrency, 1);
assert.equal(routes.codexQuotaPausePercent, 90);
assert.equal(annotation.callsCap + annotation.arbitration.callsCap + singlepass.tuningCallsCap + singlepass.blind.callsCap, 1276);
const files = ['PREREG.md', 'seed.json', 'split.json', 'routes.json', 'annotation.json', 'singlepass.json',
  'annotation-prompt.md', 'arbitration-prompt.md', 'singlepass-prompt.md',
  'README.md', 'prepare.mjs', 'check.mjs', 'step0.mk', 'ops.mk', 'quota.mjs', 'inspect.mjs', 'context.mjs', 'annotate.mjs'];
const hashes = Object.fromEntries(files.map((f) => [f, sha256(readFileSync(`${dir}/${f}`))]));
if (process.argv.includes('--freeze')) {
  const journal = '/private/annotation/calls.jsonl';
  const llmCalls = existsSync(journal) ? readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  writeFileSync(`${dir}/freeze.json`, `${JSON.stringify({ version: 3, llmCalls, files: hashes }, null, 2)}\n`);
} else assert.deepEqual(json(`${dir}/freeze.json`).files, hashes);
console.log(JSON.stringify({ status: 'contrôles hors ligne réussis', llmCalls: 0,
  supports: split.summary, futureCallsCap: 1276, cStratification: 'en attente' }));
