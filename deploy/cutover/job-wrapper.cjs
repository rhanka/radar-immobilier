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
  env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', TERMINATION_LOG: '/tmp/cutover-child.json' },
  stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 65536,
  timeout: Number(process.env.CUTOVER_TIMEOUT) * 1000,
});
let raw = {};
try { raw = JSON.parse(fs.readFileSync('/tmp/cutover-child.json', 'utf8')); }
catch { try { raw = JSON.parse(result.stdout.toString().trim()); } catch { /* No readable verdict. */ } }
const clean = { ok: result.status === 0 && !result.error };
for (const key of ['date', 'backupId', 'dumpStartedAt', 'startedAt']) {
  if (typeof raw[key] === 'string' && /^(latest|\d{4}-\d\d-\d\d(?:T[0-9:.]+Z)?)$/.test(raw[key])) clean[key] = raw[key];
}
for (const key of ['manifestSha256', 'pgSha256', 'codeSha']) {
  if (typeof raw[key] === 'string' && /^[a-f0-9]{7,64}$/.test(raw[key])) clean[key] = raw[key];
}
for (const key of ['pgSizeBytes', 'docsObjects', 'migrations', 'ageHours', 'copied', 'missing', 'sizeMismatch', 'sealedUnresolved', 'streamsBound', 'pendingReceipts', 'inventoryAnomalyCount']) {
  if (Number.isFinite(raw[key]) && raw[key] >= 0) clean[key] = raw[key];
}
for (const key of ['stale', 'staleOverridden', 'maintenanceBarrier', 'inventoryAnomaliesTruncated']) {
  if (typeof raw[key] === 'boolean') clean[key] = raw[key];
}
if (raw.status === 'open-success') clean.status = raw.status;
if (raw.epoch === 'scoped') clean.epoch = raw.epoch;
if (Array.isArray(raw.inventoryAnomalies)) {
  clean.inventoryAnomalies = raw.inventoryAnomalies.slice(0, 10).filter(a =>
    a && /^[a-f0-9]{64}$/.test(a.keySha256) && typeof a.keySha256 === 'string' &&
    Number.isSafeInteger(a.inventorySize) && a.inventorySize >= 0 &&
    Number.isSafeInteger(a.versionSize) && a.versionSize >= 0)
    .map(a => ({ keySha256: a.keySha256, inventorySize: a.inventorySize, versionSize: a.versionSize }));
  clean.inventoryAnomaliesTruncated = raw.inventoryAnomaliesTruncated === true || raw.inventoryAnomalies.length > 10;
}
// Backup listing is already normalized by the in-cluster backup library; re-allowlist it here.
if (Array.isArray(raw.backups)) {
  clean.backups = raw.backups.slice(0, 20).map(b => Object.fromEntries(Object.entries(b).filter(([k, v]) =>
    ['date', 'status', 'pgBytes', 'pgSha256', 'migrations', 'lastTag', 'docs', 'code', 'startedAt'].includes(k)
    && (v === null || typeof v === 'number' || (typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(v))))));
  for (const key of ['bucket', 'latest', 'latestComplete']) {
    if (typeof raw[key] === 'string' && /^[a-z0-9.-]{1,80}$/.test(raw[key])) clean[key] = raw[key];
  }
  clean.count = Number(raw.count) || 0;
  clean.truncated = raw.truncated === true;
}
fs.writeFileSync(file, JSON.stringify(clean));
process.exitCode = clean.ok ? 0 : 1;
