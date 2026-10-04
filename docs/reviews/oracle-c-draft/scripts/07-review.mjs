#!/usr/bin/env node
// Step 7 — adversarial review by Astra max (codex exec) and Opus 5.5 max (claude -p), seats only.
// Both run read-only inside docs/reviews/oracle-c-draft/ with review-brief.md + the commit log.
// Usage: node 07-review.mjs [astra|opus ...]   Output: work/review-<reviewer>.md (copied into review.md by hand).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, WORK } from './lib/common.mjs';
import { seatEnv } from './lib/models.mjs';

const which = process.argv.slice(2).length ? process.argv.slice(2) : ['astra', 'opus'];
const log = spawnSync('git', ['log', '--format=%h %ad %s', '--date=iso', '--', '.'], { cwd: ROOT, encoding: 'utf8' }).stdout;
const brief = `${fs.readFileSync(path.join(ROOT, 'review-brief.md'), 'utf8')}\n\n## Commit log of this folder\n\n\`\`\`\n${log}\`\`\`\n`;
fs.mkdirSync(WORK, { recursive: true });

const REVIEWERS = {
  astra: {
    cmd: 'codex',
    args: ['exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort=max', '-s', 'read-only', '--skip-git-repo-check',
      '--ephemeral', '--color', 'never', '-C', ROOT, '--output-last-message', path.join(WORK, 'review-astra.md'), '-'],
    stdin: brief,
  },
  opus: {
    cmd: 'claude',
    args: ['-p', '--model', 'claude-opus-5-5', '--effort', 'max', '--output-format', 'text',
      '--allowed-tools', 'Read,Grep,Glob', '--disallowed-tools', 'Bash,Edit,Write,WebFetch,WebSearch', '--strict-mcp-config'],
    stdin: brief,
    out: path.join(WORK, 'review-opus.md'),
  },
};

await Promise.all(which.map((k) => new Promise((resolve) => {
  const r = REVIEWERS[k];
  const started = Date.now();
  const c = spawn(r.cmd, r.args, { cwd: ROOT, env: seatEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { err += d; });
  c.on('close', (code) => {
    if (r.out) fs.writeFileSync(r.out, out);
    fs.writeFileSync(path.join(WORK, `review-${k}.meta.json`), JSON.stringify({ code, ms: Date.now() - started, stderrTail: err.slice(-2000) }, null, 1));
    console.log(`${k}: exit ${code} in ${Math.round((Date.now() - started) / 1000)} s`);
    resolve();
  });
  c.stdin.end(r.stdin);
})));
