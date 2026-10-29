// The child can emit arbitrary SQL/errors; only this wrapper owns the real termination file.
/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const process = require('node:process');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const command = JSON.parse(process.env.CUTOVER_COMMAND);
const file = '/dev/termination-log';
fs.writeFileSync(file, '{"ok":false,"reason":"interrupted"}');
try { fs.unlinkSync('/tmp/cutover-child.json'); } catch { /* A previous verdict is never reused. */ }
if (process.env.CUTOVER_EXPECTED_DATABASE && (process.env.POSTGRES_DB !== process.env.CUTOVER_EXPECTED_DATABASE
  || process.env.POSTGRES_HOST !== 'radar-postgres')) process.exit(1);
const result = spawnSync(command[0], command.slice(1), {
  env: { ...process.env, TERMINATION_LOG: '/tmp/cutover-child.json' },
  stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 65536,
  timeout: Number(process.env.CUTOVER_TIMEOUT) * 1000,
});
