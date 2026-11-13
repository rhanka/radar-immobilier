import fs from 'node:fs';
import { home, load } from './context.mjs';
const out = {};
for (const arm of ['astra-medium', 'opus-5.5-medium']) {
  const root = `${home}/annotation/${arm}`, counts = { completed: 0, valid: 0, errors: {}, attempts: 0 };
  if (fs.existsSync(root)) for (const name of fs.readdirSync(root)) {
    if (name.includes('.attempt-')) { counts.attempts++; continue; }
    const blind = name.endsWith('.sealed');
    const r = load(`${root}/${name.replace(/\.(json|sealed)$/, '')}`, blind);
    counts.completed++; counts.valid += Number(r.valid);
    if (r.error) counts.errors[r.error] = (counts.errors[r.error] ?? 0) + 1;
  }
  out[arm] = counts;
}
console.log(JSON.stringify({ at: new Date().toISOString(), arms: out }));
const journal = `${home}/annotation/calls.jsonl`;
if (fs.existsSync(journal)) {
  const calls = fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify({ intents: calls.length, first: calls[0]?.at, last: calls.at(-1)?.at,
    unfinished: calls.filter((c) => !fs.existsSync(`${home}/annotation/${c.arm}/${c.document}.attempt-${c.attempt}.${c.blind ? 'sealed' : 'json'}`)).length }));
}
if (process.argv.includes('--tuning-shape')) {
  const rows = fs.readFileSync(`${home}/tuning.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
  console.log(JSON.stringify(rows.find((r) => r.expected.units.length)?.expected.units[0]));
}
