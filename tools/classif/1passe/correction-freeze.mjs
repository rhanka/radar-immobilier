import fs from 'node:fs';
import { sha256 } from '../lib/refc1.mjs';
const dir = 'tools/classif/1passe', file = `${dir}/freeze.json`;
if (!fs.existsSync(`${dir}/freeze-before-correction.json`)) fs.copyFileSync(file, `${dir}/freeze-before-correction.json`);
const original = fs.readFileSync(`${dir}/freeze-before-correction.json`);
const freeze = JSON.parse(original);
const changed = ['matching.mjs', 'matching.test.mjs', 'reconcile.mjs', 'ops.mk', 'context.mjs'];
for (const name of changed) freeze.files[name] = sha256(fs.readFileSync(`${dir}/${name}`));
freeze.correction = { authority: 'Owner request 2026-11-13; D3 stopped at 17:57 Montreal',
  originalFreezeSha256: sha256(original), changed, llmCalls: 'Only interrupted annotation documents; no D3' };
fs.writeFileSync(file, `${JSON.stringify(freeze, null, 2)}\n`);
console.log(JSON.stringify({ changed, matcherSha256: freeze.files['matching.mjs'] }));
