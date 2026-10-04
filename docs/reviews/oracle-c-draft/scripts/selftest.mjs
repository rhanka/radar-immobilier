#!/usr/bin/env node
// Offline self-test: statistics helpers, test-set sealing and run guards, split integrity.
// Never opens the test set.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { ROOT } from './lib/common.mjs';
import { chi2Test, cohenKappa, fleissKappa, wilson } from './lib/stats.mjs';
import { sealBuffer, unsealBuffer, openTestSet, assertTestRunAllowed } from './lib/testset.mjs';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// chi-square 2x2: [[10,20],[20,10]] -> chi2 = 6.667, p = 0.00982
const t = chi2Test([[10, 20], [20, 10]]);
near(t.chi2, 6.6667); near(t.p, 0.00982, 1e-4);
// chi-square df=2 identical rows -> chi2 0, p 1
near(chi2Test([[5, 5, 5], [5, 5, 5]]).p, 1);
// Cohen's kappa classic example: po=0.7, pe=0.5 -> 0.4
const a = [...Array(25).fill('y'), ...Array(25).fill('n')];
const b = [...Array(20).fill('y'), ...Array(5).fill('n'), ...Array(10).fill('y'), ...Array(15).fill('n')];
near(cohenKappa(a, b, ['y', 'n']).kappa, 0.4);
// Fleiss kappa: perfect agreement -> 1
near(fleissKappa([['P', 'P', 'P'], ['N', 'N', 'N']], ['P', 'S', 'N']).kappa, 1);
const [lo, hi] = wilson(5, 10); near(lo, 0.2366); near(hi, 0.7634);

// seal / unseal round trip and tamper detection (synthetic data only)
{
  const key = crypto.randomBytes(32);
  const plain = Buffer.from('{"id":"x"}\n');
  const sealed = sealBuffer(plain, key);
  assert.equal(unsealBuffer(sealed, key).toString(), plain.toString());
  const bad = Buffer.from(sealed); bad[bad.length - 1] ^= 1;
  assert.throws(() => unsealBuffer(bad, key));
  assert.throws(() => unsealBuffer(sealed, crypto.randomBytes(32)));
}
// test set refused without the executor role
{
  const role = process.env.ORACLE_C_ROLE; delete process.env.ORACLE_C_ROLE;
  assert.throws(() => openTestSet({ purpose: 'selftest' }), /test-executor/);
  if (role) process.env.ORACLE_C_ROLE = role;
}
// a second test run of the frozen prompt is refused (the audit log holds the first)
{
  const fin = JSON.parse(fs.readFileSync(path.join(ROOT, 'final-prompt.json'), 'utf8'));
  assert.throws(() => assertTestRunAllowed({ promptVersion: fin.version, promptSha256: fin.sha256, model: 'gpt-6-astra' }), /already run|not committed|differs/);
}

// frozen split integrity: dev set hash; the test set is sealed outside the repo (hash only)
const sums = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'SHA256SUMS'), 'utf8').trim().split('\n')
  .map((l) => l.split(/\s+/)).map(([h, f]) => [f, h]));
if (fs.existsSync(path.join(ROOT, 'optim.jsonl'))) { // the dev set is kept locally, not versioned (D6)
  const optimBody = fs.readFileSync(path.join(ROOT, 'optim.jsonl'));
  assert.equal(crypto.createHash('sha256').update(optimBody).digest('hex'), sums['optim.jsonl'], 'optim.jsonl sha256 drifted');
}
assert.ok(/^[0-9a-f]{64}$/.test(sums['blind.jsonl']), 'blind.jsonl hash missing');
assert.ok(!fs.existsSync(path.join(ROOT, 'blind.jsonl')), 'plaintext test set must not sit in the workspace (seal it: 09-seal-test.mjs)');
console.log('selftest ok');
