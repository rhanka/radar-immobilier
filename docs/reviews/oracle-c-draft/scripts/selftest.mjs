#!/usr/bin/env node
// Offline self-test: statistics helpers + integrity of the frozen split (sha256, disjoint cities).
// Reads blind.jsonl only to hash it and to check ids/cities, never its labels or inputs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { ROOT } from './lib/common.mjs';
import { chi2Test, cohenKappa, fleissKappa, wilson } from './lib/stats.mjs';

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

// frozen split integrity
const sums = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'SHA256SUMS'), 'utf8').trim().split('\n')
  .map((l) => l.split(/\s+/)).map(([h, f]) => [f, h]));
const cities = {};
for (const f of ['optim.jsonl', 'blind.jsonl']) {
  const body = fs.readFileSync(path.join(ROOT, f));
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), sums[f], `${f} sha256 drifted`);
  cities[f] = new Set(body.toString('utf8').trim().split('\n').map((l) => JSON.parse(l).city));
}
for (const c of cities['optim.jsonl']) assert.ok(!cities['blind.jsonl'].has(c), `city in both sets: ${c}`);
console.log('selftest ok');
