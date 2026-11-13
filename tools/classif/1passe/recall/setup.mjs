import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { sha256 } from '../../lib/refc1.mjs';
const dir = 'tools/classif/1passe/recall';
const ref = execFileSync('git', ['rev-parse', 'feat/refresh-single-pass'], { encoding: 'utf8' }).trim();
const source = execFileSync('git', ['show', `${ref}:radar/prompts/refresh-single-pass-v1.md`], { encoding: 'utf8' });
if (sha256(source) !== '8957bcaa146b3b83ee89000fccec3c6f393c7b801b320a158d58d2631fa3a205') throw Error('production prompt changed');
const extension = fs.readFileSync(`${dir}/extension.md`, 'utf8');
const prompt = source.slice(0, source.lastIndexOf('## Output')) + extension;
fs.writeFileSync(`${dir}/prompt.md`, prompt, { flag: 'wx' });
fs.writeFileSync(`${dir}/freeze.json`, JSON.stringify({ version: 1, at: new Date().toISOString(),
  productionRef: ref, productionPromptSha256: sha256(source),
  p0Sha256: sha256(fs.readFileSync('tools/classif/l4/prompts/P0.md')),
  promptSha256: sha256(prompt), extensionSha256: sha256(extension),
  model: 'gpt-6-astra', effort: 'low', concurrency: 10, callsCap: 100,
  quotaStop: 90, quotaCheckMs: 600000, population: 676,
  matching: '1passe/matching.mjs frozen inherited matcher; one-to-one; exact evidence',
  metrics: ['detection/B', 'visible/B', 'P_union_S/B'], wilson: 'two-sided 95% lower bound, z=1.959963984540054',
  blind: 'one shot; REFC1; aggregate only; no optimizer',
  delta: 'Full PV instead of PDF chunk; flat detection acts instead of graph nodes/annotations; same classification body.' }, null, 2) + '\n', { flag: 'wx' });
