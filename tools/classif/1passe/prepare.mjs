// Préparation locale. Aucun import de runner ni accès réseau.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { sha256, sealToFile } from '../lib/refc1.mjs';

const dir = 'tools/classif/1passe';
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const seed = read(`${dir}/seed.json`);
const oracle = read('/private/source/consensus.json');
const unresolved = read('/private/source/unresolved.json');
const manifest = read('/private/source/manifest.json');
const units = oracle.units;
assert.equal(units.length, 676);
assert.equal(new Set(units.map((u) => u.id)).size, 676);
assert.equal(unresolved.entries.length, 43);
assert.equal(manifest.documents.length, 100);
const ids = new Set(units.map((u) => u.id));
const overlaps = unresolved.entries.filter((u) => ids.has(`${u.documentId}#${u.unitId}`));
assert.equal(overlaps.length, 0, 'Cas neutres distincts des unités présentes');
const docs = manifest.documents;
assert.equal(new Set(docs.map((d) => d.city)).size, 100);
const unitDocs = new Set(units.map((u) => u.documentId));
assert(units.every((u) => docs.some((d) => d.id === u.documentId)));
const halves = { tuning: [], blind: [] };
for (const present of [true, false]) {
  const group = docs.filter((d) => unitDocs.has(d.id) === present)
    .sort((a, b) => sha256(`${seed.seed}|${a.id}`).localeCompare(sha256(`${seed.seed}|${b.id}`)));
  const offset = halves.tuning.length > halves.blind.length ? 1 : 0;
  for (const [i, d] of group.entries()) halves[(i + offset) % 2 ? 'blind' : 'tuning'].push(d.id);
}
for (const list of Object.values(halves)) list.sort();
assert.equal(halves.tuning.length, 50);
assert.equal(halves.blind.length, 50);
assert.equal(new Set([...halves.tuning, ...halves.blind]).size, 100);
const target = '/private/blind/blind.sealed';
assert(!existsSync(target), 'Refus de retirer ou de remplacer le sceau');
mkdirSync('/private/blind', { recursive: true, mode: 0o700 });
mkdirSync('/private/custody', { recursive: true, mode: 0o700 });
const key = randomBytes(32);
// Garde locale : l’opérateur remet cette clé au seul exécuteur. Jamais au runner modèle.
writeFileSync('/private/custody/blind-key.base64', key.toString('base64'), { flag: 'wx', mode: 0o600 });
const records = (half) => halves[half].map((id) => ({
  itemId: id, input: { document: docs.find((d) => d.id === id) },
  expected: { units: units.filter((u) => u.documentId === id),
    neutral: unresolved.entries.filter((u) => u.documentId === id), cLabels: null },
}));
const plain = Buffer.from(`${records('blind').map((r) => JSON.stringify(r)).join('\n')}\n`);
const hashes = sealToFile(key, plain, target);
chmodSync(target, 0o600);
const tuning = `${records('tuning').map((r) => JSON.stringify(r)).join('\n')}\n`;
writeFileSync('/private/tuning.jsonl', tuning, { flag: 'wx', mode: 0o600 });
writeFileSync('/private/blind/access-log.jsonl', `${JSON.stringify({
  action: 'seal-blind-set', actor: 'step0', rows: 50, ...hashes,
})}\n`, { flag: 'wx', mode: 0o600 });
const summary = Object.fromEntries(Object.entries(halves).map(([half, list]) => [half, {
  pv: list.length, bActs: units.filter((u) => list.includes(u.documentId)).length,
  neutral: unresolved.entries.filter((u) => list.includes(u.documentId)).length,
  cShownActs: null, cStratification: 'non disponible avant annotation C',
}]));
const split = {
  version: 1, seed: seed.seed, sourceCommit: readFileSync('/private/source/main-sha', 'utf8').trim(),
  sources: Object.fromEntries(['consensus.json', 'unresolved.json', 'manifest.json']
    .map((f) => [f, sha256(readFileSync(`/private/source/${f}`))])),
  summary, tuning: halves.tuning, blind: halves.blind,
  tuningDataSha256: sha256(tuning),
  tuningIdsSha256: sha256(`${halves.tuning.join('\n')}\n`),
  blindIdsSha256: sha256(`${halves.blind.join('\n')}\n`),
  blindSeal: hashes,
};
writeFileSync(`${dir}/split.json`, `${JSON.stringify(split)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ summary, blindSeal: hashes, unitOverlap: overlaps.length }));
