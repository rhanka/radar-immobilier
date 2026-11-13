import fs from 'node:fs';
import { home, json } from './context.mjs';
const calls = fs.existsSync(`${home}/calls.jsonl`) ? fs.readFileSync(`${home}/calls.jsonl`, 'utf8').trim().split('\n').filter(Boolean).length : 0;
const responses = fs.existsSync(`${home}/responses`) ? fs.readdirSync(`${home}/responses`).filter((p) => /\.(json|sealed)$/.test(p)).length : 0;
console.log(JSON.stringify({ calls, responses, inFlightOrInterrupted: calls - responses,
  finished: fs.existsSync(`${home}/run-summary.json`), quotas: fs.existsSync(`${home}/quotas.json`) ? json(`${home}/quotas.json`) : [] }));
