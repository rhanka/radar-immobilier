#!/usr/bin/env node
// Runs 05-run.mjs for the three models in parallel. Same arguments as 05-run.mjs minus --model.
// Usage: node run-all.mjs --set optim --prompt v1 [--concurrency 3] [--only id1,id2]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pass = process.argv.slice(2);
const models = (process.env.ORACLE_C_MODELS ?? 'astra,gemini,opus').split(',');
const codes = await Promise.all(models.map((m) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(here, '05-run.mjs'), ...pass, '--model', m], { stdio: 'inherit' });
  c.on('close', resolve);
})));
process.exit(codes.some((c) => c !== 0) ? 1 : 0);
