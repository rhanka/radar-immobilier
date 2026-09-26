#!/usr/bin/env node
'use strict';
// =============================================================================
// backup-daily.cjs — DAILY PROD BACKUP of radar-immobilier (PostgreSQL + docs S3).
//
// One file, three modes (argv[2]), each run with its OWN identity:
//   backup     initContainer `backup` of CronJob radar-backup-daily — identity
//              radar-backup-writer (Put/Get/List/multipart, NO delete right);
//              writes the backup of the day + a purge PLAN in WORK_DIR.
//   purge      container `purge` of the same pod, starts only after `backup`
//              exited 0 — identity radar-backup-purger (DeleteObject only, dated
//              prefixes); executes the plan, and only when the backup is complete.
//   freshness  CronJob radar-backup-freshness — identity radar-backup-reader;
//              fails when the newest backup is stale or not complete for too long.
// Mounted from the ConfigMap `radar-backup-daily-script` that the CD renders from
// THIS file. Image = radar-api (Node + @aws-sdk/client-s3) already pinned by
// digest in the prod bundle: 0 python, 0 new image. The `dump` initContainer
// (postgis image: pg_dump / pg_restore / pg_dumpall) ran first and left in WORK_DIR:
//   radar.dump            pg_dump -Fc of the prod DB (RO role radar_db_ro_prod)
//   radar.dump.sha256     `sha256sum` line of the dump (coreutils)
//   dump.env              KEY=VALUE facts (DATE, versions, TOC count, globals)
//   migrations.sql        pg_restore -a of drizzle.__drizzle_migrations (from the dump)
//   globals.sql(.sha256)  pg_dumpall --globals-only --no-role-passwords (best-effort)
//
// One run = one coherent backup of day D (UTC) in s3://$BACKUP_BUCKET:
//   pg/D/radar.dump (+ .sha256)          dump, re-read after upload (sha256)
//   pg/D/globals.sql (+ .sha256)         roles/tablespaces, no passwords
//   docs/<key>                           incremental server-side mirror of
//                                        $SOURCE_DOCS_BUCKET (bucket versioning
//                                        keeps prior contents)
//   docs-inventory/D.json                source state at D (key, size, ETag) +
//                                        the backup ETag/version that holds it
//   manifests/D.json                     THE backup record of day D
//   manifests/latest.json                pointer: newest + latestComplete
// then the retention purge (RETENTION.md), in the separate `purge` step:
// delete-markers ONLY (DeleteObject without VersionId) on dated objects outside
// the daily/weekly/monthly policy, planned by `backup`, executed by `purge`.
//
// Manifest status: complete | partial (docs objects still pending — time budget,
// request deadline, SIGTERM — or inventory not written; no error answer — exit 0,
// not a failure; `partialReason` says why) | incomplete (docs errors — exit 4).
//
// S3 DEADLINES (incident 2026-09-26 on geo: one CopyObject never answered, the Job
// died on activeDeadlineSeconds with no manifest, no inventory, no latest.json):
// every S3 call goes through s3send() — a wall-clock deadline per command (SDK
// retries included), an AbortSignal handed to the SDK AND a race on it. The docs
// budget aborts the copies in flight (they stay `pending`); SIGTERM stops the copy
// and the inventory + manifest (partial) + latest.json are still written, each
// request capped to the termination grace period. Same design and variable names
// as rhanka/geo#409 (README.md "S3 request timeouts, budget and SIGTERM").
//
// Order = DB first, docs second: prod docs are append-mostly, so every doc the
// DB references at dump time is already listed when the docs step runs.
//
// LOGS = verdict only: counts, backup keys, sha256. Never a doc key, never a
// row, never a credential. SDK errors are reported as name/http-status.
//
// EXIT CODES (podFailurePolicy in the CronJob maps 2/3/4 to FailJob, no retry):
//   0 backup complete or partial (seed in progress, budget, request deadlines) /
//     purge done or skipped / fresh
//   1 retryable failure before the manifest (network, S3 5xx / request deadline,
//     re-read mismatch), or SIGTERM (partial manifest recorded when the PG part was)
//   2 refusal: bucket guard, versioning off, dump size anomaly, docs source
//     empty or collapsed (no manifest, no purge)
//   3 purge planning or execution failed AFTER a complete manifest (backup valid)
//   4 manifest written with status=incomplete (docs copy/listing errors)
//   5 freshness check failed (stale or not complete for too long)
// =============================================================================

// CommonJS on purpose: the SDK is resolved through NODE_PATH=/workspace/node_modules of
// the radar-api image, which only require() honours (ESM import ignores NODE_PATH).
/* global require, module, __filename */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const process = require('node:process');
const console = require('node:console');
const { Buffer } = require('node:buffer');
const { setTimeout, clearTimeout } = require('node:timers');
const { AbortController } = globalThis;

const EXIT = Object.freeze({ OK: 0, RETRYABLE: 1, INTEGRITY: 2, PURGE_FAILED: 3, DOCS_INCOMPLETE: 4, STALE: 5 });

class BackupError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = 'BackupError';
    this.exitCode = exitCode;
  }
}

const MIB = 1024 * 1024;
const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const LAYOUT = Object.freeze({
  docsPrefix: 'docs/',
  datedPrefixes: Object.freeze(['pg/', 'docs-inventory/', 'manifests/']),
  latestKey: 'manifests/latest.json',
});

// ── dates ────────────────────────────────────────────────────────────────────
function dayNumber(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw new Error('invalid date');
  const ms = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error('invalid date');
  return Math.round(ms / DAY_MS);
}
function isValidDate(date) {
  try { dayNumber(date); return true; } catch { return false; }
}
// ISO week (Monday..Sunday). Day 0 = 1970-01-01, a Thursday.
function isoWeekIndex(date) { return Math.floor((dayNumber(date) + 3) / 7); }
function monthIndex(date) { dayNumber(date); return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1; }
function weekdayUtc(date) { return new Date(dayNumber(date) * DAY_MS).getUTCDay(); } // 0 = Sunday

// ── key layout ───────────────────────────────────────────────────────────────
function keysFor(date) {
  return {
    dump: `pg/${date}/radar.dump`,
    dumpSha: `pg/${date}/radar.dump.sha256`,
    globals: `pg/${date}/globals.sql`,
    globalsSha: `pg/${date}/globals.sql.sha256`,
    inventory: `docs-inventory/${date}.json`,
    manifest: `manifests/${date}.json`,
  };
}
// Dated backup objects the retention purge may touch. Anything else (docs/,
// manifests/latest.json, unknown names) → null → never purged.
function classifyKey(key) {
  let m = /^pg\/(\d{4}-\d{2}-\d{2})\/[^/]+$/.exec(key);
  if (m && isValidDate(m[1])) return { kind: 'pg', date: m[1] };
  m = /^docs-inventory\/(\d{4}-\d{2}-\d{2})\.json$/.exec(key);
  if (m && isValidDate(m[1])) return { kind: 'inventory', date: m[1] };
  m = /^manifests\/(\d{4}-\d{2}-\d{2})\.json$/.exec(key);
  if (m && isValidDate(m[1])) return { kind: 'manifest', date: m[1] };
  return null;
}

// ── retention (see RETENTION.md) ─────────────────────────────────────────────
// dates         every date that still has a dated object (complete or not)
// completeDates dates that have a manifest (= a recorded backup)
// Kept:
//   daily    every date younger than dailyDays (incl. unfinished days, for diagnosis)
//   weekly   the LATEST complete backup of each ISO week (= the Sunday when it
//            ran) younger than weeklyWeeks*7 days
//   monthly  the EARLIEST complete backup of each month (= the 1st when it ran)
//            for the current month and the monthlyMonths-1 previous ones
//   min-keep the minKeep newest complete backups whatever their age (an outage
//            never shrinks the history to a single point)
//   future   dates after today (clock skew) are never purged
function planRetention({ today, dates, completeDates, dailyDays = 7, weeklyWeeks = 4, monthlyMonths = 6, minKeep = 7 }) {
  const t = dayNumber(today);
  const complete = [...new Set(completeDates || [])].filter(isValidDate).sort();
  const all = [...new Set([...(dates || []), ...complete])].filter(isValidDate).sort();
  const reasons = new Map();
  const add = (d, r) => { if (!reasons.has(d)) reasons.set(d, []); if (!reasons.get(d).includes(r)) reasons.get(d).push(r); };
  for (const d of all) {
    const age = t - dayNumber(d);
    if (age < 0) add(d, 'future');
    else if (age < dailyDays) add(d, 'daily');
  }
  const latestOfWeek = new Map();
  for (const d of complete) latestOfWeek.set(isoWeekIndex(d), d); // ascending → last write = latest
  for (const d of latestOfWeek.values()) {
    const age = t - dayNumber(d);
    if (age >= 0 && age < weeklyWeeks * 7) add(d, 'weekly');
  }
  const earliestOfMonth = new Map();
  for (const d of complete) if (!earliestOfMonth.has(monthIndex(d))) earliestOfMonth.set(monthIndex(d), d);
  const tm = monthIndex(today);
  for (const d of earliestOfMonth.values()) {
    const dm = tm - monthIndex(d);
    if (dm >= 0 && dm < monthlyMonths) add(d, 'monthly');
  }
  for (const d of complete.slice(-Math.max(0, minKeep))) add(d, 'min-keep');
  const keep = all.filter((d) => reasons.has(d));
  const purge = all.filter((d) => !reasons.has(d));
  return { keep, purge, reasons: Object.fromEntries([...reasons.entries()].sort()) };
}

// ── small parsers ────────────────────────────────────────────────────────────
function parseEnvFile(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.replace(/\r$/, ''));
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
function parseSha256Line(text) {
  const m = /^([0-9a-f]{64})\s+\*?(\S.*)$/.exec(String(text || '').trim());
  return m ? { sha256: m[1], name: m[2].trim() } : null;
}
// Rows of drizzle.__drizzle_migrations as emitted by `pg_restore --data-only`
// (COPY ... FROM stdin; block). Returns null when the table is absent.
function parseMigrationsCopy(text) {
  const lines = String(text || '').split('\n');
  const start = lines.findIndex((l) => /^COPY\s+"?drizzle"?\."?__drizzle_migrations"?\s*\(/.test(l));
  if (start < 0) return null;
  const cols = /\(([^)]*)\)/.exec(lines[start])[1].split(',').map((c) => c.trim().replace(/"/g, ''));
  const rows = [];
  for (let i = start + 1; i < lines.length && lines[i] !== '\\.'; i++) {
    if (!lines[i]) continue;
    const vals = lines[i].split('\t');
    const row = {};
    cols.forEach((c, j) => { row[c] = vals[j] === undefined || vals[j] === '\\N' ? null : vals[j]; });
    rows.push(row);
  }
  let last = null;
  for (const r of rows) if (!last || Number(r.id) > Number(last.id)) last = r;
  return {
    migrationsApplied: rows.length,
    lastMigration: last ? { id: Number(last.id), hash: last.hash, createdAt: last.created_at } : null,
  };
}
function resolveMigrationTag(createdAt, journal) {
  if (createdAt === null || createdAt === undefined || !journal || !Array.isArray(journal.entries)) return null;
  const e = journal.entries.find((x) => String(x.when) === String(createdAt));
  return e && typeof e.tag === 'string' ? e.tag : null;
}
function parsePrefixes(csv) {
  return String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function withScheme(endpoint) {
  const e = String(endpoint || '').trim();
  if (!e) return '';
  return /^https?:\/\//i.test(e) ? e : 'https://' + e;
}
function encodeKey(k) { return encodeURIComponent(k).replace(/%2F/g, '/'); }
function errName(e) {
  const status = e && e.$metadata && e.$metadata.httpStatusCode;
  return `${(e && (e.name || e.Code || e.code)) || 'Error'}${status ? '/' + status : ''}`;
}
function isAccessDenied(e) {
  const status = e && e.$metadata && e.$metadata.httpStatusCode;
  return status === 403 || (e && (e.name === 'AccessDenied' || e.Code === 'AccessDenied'));
}
function isNotFound(e) {
  const status = e && e.$metadata && e.$metadata.httpStatusCode;
  return status === 404 || (e && ['NoSuchKey', 'NotFound'].includes(e.name));
}

// Absolute floor + relative drop versus the previous backup. Both refuse (exit 2).
function checkDumpSize({ size, previousSize, minBytes, minRatio }) {
  if (!(size >= minBytes)) return { ok: false, reason: `dump size ${size} < MIN_DUMP_BYTES ${minBytes}` };
  if (minRatio > 0 && Number(previousSize) > 0 && size < previousSize * minRatio) {
    return { ok: false, reason: `dump size ${size} < ${minRatio} x previous ${previousSize}` };
  }
  return { ok: true, reason: null };
}

// Docs source guard: an empty or collapsed source listing (wrong bucket, broken
// credentials returning nothing, mass deletion) must never produce a "complete"
// backup — refuse (exit 2, no manifest, no purge).
function checkDocsSource({ count, previousCount, minRatio }) {
  if (!(count > 0)) return { ok: false, reason: 'docs source lists 0 objects' };
  if (minRatio > 0 && Number(previousCount) > 0 && count < previousCount * minRatio) {
    return { ok: false, reason: `docs source lists ${count} objects < ${minRatio} x previous ${previousCount}` };
  }
  return { ok: true, reason: null };
}

// Manifest status from the docs outcome (PG is always complete once we get here).
// `complete` needs EVERY listed object backed up or excluded (0 pending, 0 failed,
// backedUp + excluded = objects) AND the inventory that proves it written
// (`inventoryWritten` false → partial). Never complete with an object missing.
function docsStatus(counts, docsError, inventoryWritten = true) {
  if (docsError || !counts || counts.failed > 0) return 'incomplete';
  const allThere = counts.pending === 0 && counts.backedUp + counts.excluded === counts.objects;
  if (!allThere || !inventoryWritten) return 'partial';
  return 'complete';
}

// Why a backup is not complete, in one line (null when complete). Counts and stop
// reasons only, never a key. A request deadline leaves the object `pending` on immo
// (counted in `timedOut`): partial, exit 0, retried next night — geo#409 counts it
// `failed`, which is also partial / exit 0 there; `failed` stays a real S3 error
// answer on immo (incomplete, exit 4).
function partialReasonOf(docs, budgetSeconds) {
  if (!docs || docs.status === 'complete') return null;
  if (docs.error) return `docs step failed (${docs.error})`;
  const parts = [];
  if (docs.stopReason === 'terminated') parts.push('terminated (SIGTERM) before the copy finished');
  else if (docs.budgetExhausted) parts.push(`docs copy budget reached (${budgetSeconds} s)`);
  if (docs.failed) parts.push(`${docs.failed} object(s) failed`);
  if (docs.pending) parts.push(`${docs.pending} object(s) pending${docs.timedOut ? ` (${docs.timedOut} timed out)` : ''}`);
  if (!docs.inventoryKey) parts.push(`inventory not written (${docs.inventoryError || 'unknown'})`);
  return parts.length ? parts.join('; ') : 'docs not complete';
}

// Freshness of manifests/latest.json (mode `freshness`, reader identity):
//   stale      newest backup older than maxAgeDays (default 1 = today or yesterday)
//   not complete for too long: last complete backup (or, when none yet, the first
//              backup) older than maxIncompleteDays (default 3)
function checkFreshness({ today, latest, maxAgeDays = 1, maxIncompleteDays = 3 }) {
  if (!latest || !isValidDate(latest.date)) return { ok: false, reasons: ['no valid manifests/latest.json'] };
  const t = dayNumber(today);
  const reasons = [];
  const age = t - dayNumber(latest.date);
  if (age > maxAgeDays) reasons.push(`newest backup ${latest.date} is ${age} days old (max ${maxAgeDays})`);
  const lc = latest.latestComplete && latest.latestComplete.date;
  const since = isValidDate(lc) ? lc : latest.firstBackupDate;
  if (!isValidDate(since)) reasons.push('no complete backup recorded and no first backup date');
  else if (t - dayNumber(since) > maxIncompleteDays) {
    reasons.push(isValidDate(lc)
      ? `last complete backup ${lc} is ${t - dayNumber(lc)} days old (max ${maxIncompleteDays})`
      : `no complete backup since the first one (${since}, max ${maxIncompleteDays} days)`);
  }
  return { ok: reasons.length === 0, reasons, age };
}

// ── docs planning ────────────────────────────────────────────────────────────
// Up to date in the backup = same Size AND (same ETag OR backup copy written
// strictly after the last source write). ETag alone is not enough: a server-side
// copy of a multipart source gets a different ETag. LastModified catches a
// source object rewritten under the same name (its LastModified moves past the
// copy); strict `>` recopies on a same-second tie (safe direction).
function upToDate(src, dst) {
  return !!dst && Number(dst.Size) === Number(src.Size) &&
    (dst.ETag === src.ETag ||
      (!!dst.LastModified && !!src.LastModified && new Date(dst.LastModified).getTime() > new Date(src.LastModified).getTime()));
}
function planDocs(srcObjs, dstIndex, excludePrefixes) {
  const fresh = []; const todo = []; const excluded = [];
  for (const o of srcObjs) {
    if (upToDate(o, dstIndex.get(o.Key))) fresh.push(o);
    else if (excludePrefixes.some((p) => o.Key.startsWith(p))) excluded.push(o);
    else todo.push(o);
  }
  return { fresh, todo, excluded };
}
function buildInventory({ date, createdAt, sourceBucket, backupBucket, excludePrefixes, versionIds, srcObjs, dstIndex, copied, failed }) {
  const objects = [...srcObjs].sort((a, b) => (a.Key < b.Key ? -1 : a.Key > b.Key ? 1 : 0)).map((o) => {
    const base = {
      key: o.Key,
      size: Number(o.Size),
      etag: o.ETag || null,
      lastModified: o.LastModified ? new Date(o.LastModified).toISOString() : null,
    };
    const c = copied.get(o.Key);
    if (c) return { ...base, state: 'backed-up', backupEtag: c.etag, versionId: c.versionId };
    const d = dstIndex.get(o.Key);
    if (upToDate(o, d)) return { ...base, state: 'backed-up', backupEtag: d.ETag || null, versionId: d.VersionId || null };
    const state = failed.has(o.Key) ? 'failed' : excludePrefixes.some((p) => o.Key.startsWith(p)) ? 'excluded' : 'pending';
    return { ...base, state, backupEtag: null, versionId: null };
  });
  const counts = { objects: objects.length, totalBytes: 0, backedUp: 0, pending: 0, failed: 0, excluded: 0 };
  for (const o of objects) {
    counts.totalBytes += o.size;
    if (o.state === 'backed-up') counts.backedUp += 1;
    else counts[o.state] += 1;
  }
  return {
    format: 'radar-backup-docs-inventory/v1',
    date,
    createdAt,
    sourceBucket,
    backupBucket,
    backupPrefix: LAYOUT.docsPrefix,
    excludedPrefixes: excludePrefixes,
    versionIds,
    counts,
    objects,
  };
}

// ── config ───────────────────────────────────────────────────────────────────
// Per-request S3 deadlines, the three modes (names and defaults of rhanka/geo#409):
//   connectMs      TCP/TLS connect (NodeHttpHandler connectionTimeout)
//   requestMs      socket idle bound (NodeHttpHandler socketTimeout) AND floor of
//                  the wall-clock deadline of a copy / write / body transfer
//   metaMs         wall-clock deadline of HEAD / LIST / versioning / delete / small GET
//   minBytesPerSec a body or server-side copy of N bytes gets max(requestMs, N / minBytesPerSec)
const DEFAULT_TIMEOUTS = Object.freeze({ connectMs: 10000, requestMs: 120000, metaMs: 30000, minBytesPerSec: 8 * MIB });
function numEnv(env, name, def, { min = 0, integer = true } = {}) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || (integer && !Number.isInteger(v))) throw new BackupError(EXIT.INTEGRITY, `invalid ${name}`);
  return v;
}
function readTimeouts(env) {
  return {
    connectMs: numEnv(env, 'S3_CONNECT_TIMEOUT_MS', DEFAULT_TIMEOUTS.connectMs, { min: 1 }),
    requestMs: numEnv(env, 'S3_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUTS.requestMs, { min: 1 }),
    metaMs: numEnv(env, 'S3_META_TIMEOUT_MS', DEFAULT_TIMEOUTS.metaMs, { min: 1 }),
    minBytesPerSec: numEnv(env, 'S3_MIN_THROUGHPUT_BYTES_PER_SEC', DEFAULT_TIMEOUTS.minBytesPerSec, { min: 1 }),
  };
}
// mode: backup (writer: needs SOURCE_DOCS_BUCKET) | purge (purger) | freshness (reader).
function readConfig(env, mode = 'backup') {
  const req = (name) => {
    const v = String(env[name] || '').trim();
    if (!v) throw new BackupError(EXIT.INTEGRITY, `missing ${name}`);
    return v;
  };
  const num = (name, def, { min = 0, integer = true } = {}) => {
    const raw = env[name];
    if (raw === undefined || String(raw).trim() === '') return def;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < min || (integer && !Number.isInteger(v))) throw new BackupError(EXIT.INTEGRITY, `invalid ${name}`);
    return v;
  };
  const cfg = {
    timeouts: readTimeouts(env),
    endpoint: withScheme(req('S3_ENDPOINT')),
    region: req('S3_REGION'),
    forcePathStyle: String(env.S3_FORCE_PATH_STYLE || 'false').trim() === 'true',
    accessKeyId: req('S3_ACCESS_KEY'),
    secretAccessKey: req('S3_SECRET_KEY'),
    mode,
    backupBucket: req('BACKUP_BUCKET'),
    sourceBucket: mode === 'backup' ? req('SOURCE_DOCS_BUCKET') : String(env.SOURCE_DOCS_BUCKET || '').trim(),
    expectedBackupBucket: String(env.EXPECTED_BACKUP_BUCKET || '').trim(),
    expectedSourceBucket: String(env.EXPECTED_SOURCE_DOCS_BUCKET || '').trim(),
    expectedDatabase: String(env.EXPECTED_DATABASE || 'radar').trim(),
    workDir: String(env.WORK_DIR || '/work'),
    publicHealthUrl: String(env.PUBLIC_HEALTH_URL || '').trim(),
    drizzleJournal: String(env.DRIZZLE_JOURNAL || '').trim(),
    backupImage: String(env.BACKUP_IMAGE || 'unknown').trim(),
    copyConcurrency: Math.min(32, num('COPY_CONCURRENCY', 8, { min: 1 })),
    docsBudgetSeconds: num('DOCS_COPY_BUDGET_SECONDS', 5400, { min: 1 }),
    // = the pod terminationGracePeriodSeconds: after SIGTERM, the final writes
    // (inventory, manifest, latest.json) are bounded to fit in it.
    terminationGraceSeconds: num('TERMINATION_GRACE_SECONDS', 120, { min: 15 }),
    excludePrefixes: parsePrefixes(env.DOCS_EXCLUDE_PREFIXES),
    minDumpBytes: num('MIN_DUMP_BYTES', MIB, { min: 1 }),
    minDumpRatio: num('MIN_DUMP_RATIO', 0.5, { min: 0, integer: false }),
    minDocsRatio: num('MIN_DOCS_RATIO', 0.5, { min: 0, integer: false }),
    multipartThreshold: num('MULTIPART_THRESHOLD_BYTES', 4096 * MIB, { min: 5 * MIB }),
    partSize: num('MULTIPART_PART_BYTES', 64 * MIB, { min: 5 * MIB }),
    retention: {
      dailyDays: num('RETENTION_DAILY_DAYS', 7, { min: 1 }),
      weeklyWeeks: num('RETENTION_WEEKLY_WEEKS', 4, { min: 0 }),
      monthlyMonths: num('RETENTION_MONTHLY_MONTHS', 6, { min: 0 }),
      minKeep: num('RETENTION_MIN_KEEP', 7, { min: 1 }),
    },
    purgeDryRun: String(env.PURGE_DRY_RUN || 'false').trim() === 'true',
    freshness: {
      maxAgeDays: num('FRESHNESS_MAX_AGE_DAYS', 1, { min: 0 }),
      maxIncompleteDays: num('FRESHNESS_MAX_INCOMPLETE_DAYS', 3, { min: 0 }),
    },
  };
  if (cfg.minDumpRatio >= 1) throw new BackupError(EXIT.INTEGRITY, 'invalid MIN_DUMP_RATIO (must be < 1)');
  if (cfg.minDocsRatio >= 1) throw new BackupError(EXIT.INTEGRITY, 'invalid MIN_DOCS_RATIO (must be < 1)');
  return cfg;
}
// Positive bucket guard (same idea as EXPECTED_DATABASE): a misconfigured secret
// must never make this job write into the docs bucket or read the wrong one.
function assertBuckets(cfg) {
  if (cfg.expectedBackupBucket && cfg.backupBucket !== cfg.expectedBackupBucket) {
    throw new BackupError(EXIT.INTEGRITY, 'BACKUP_BUCKET differs from EXPECTED_BACKUP_BUCKET');
  }
  if (cfg.mode !== 'backup') return;
  if (cfg.backupBucket === cfg.sourceBucket) throw new BackupError(EXIT.INTEGRITY, 'BACKUP_BUCKET equals SOURCE_DOCS_BUCKET');
  if (cfg.expectedSourceBucket && cfg.sourceBucket !== cfg.expectedSourceBucket) {
    throw new BackupError(EXIT.INTEGRITY, 'SOURCE_DOCS_BUCKET differs from EXPECTED_SOURCE_DOCS_BUCKET');
  }
}

// ── manifest ─────────────────────────────────────────────────────────────────
function buildManifest({ date, startedAt, completedAt, cfg, pg, schema, code, docs, tool }) {
  return {
    format: 'radar-backup-manifest/v1',
    date,
    status: docs.status, // complete | partial | incomplete (PG is complete at this point)
    partialReason: partialReasonOf(docs, cfg.docsBudgetSeconds),
    startedAt,
    completedAt,
    backupBucket: cfg.backupBucket,
    pg,
    schema,
    code,
    docs,
    retention: { ...cfg.retention, mechanism: 'delete-marker purge of dated folders (purger identity) + bucket lock/lifecycle (RETENTION.md)' },
    tool,
  };
}
// latestComplete / firstBackupDate carry over from the previous pointer so the
// freshness check can tell "seed in progress since D" from "complete yesterday".
function buildLatestPointer(manifest, manifestKey, manifestSha256, previous) {
  const prev = previous && typeof previous === 'object' ? previous : {};
  const latestComplete = manifest.status === 'complete'
    ? { date: manifest.date, manifestKey }
    : (prev.latestComplete && isValidDate(prev.latestComplete.date) ? prev.latestComplete : null);
  // First day of the current run of non-complete backups (null once complete).
  const prevNotComplete = !!prev.status && prev.status !== 'complete';
  const partialSince = manifest.status === 'complete' ? null
    : prevNotComplete && isValidDate(prev.partialSince) ? prev.partialSince
      : prevNotComplete && isValidDate(prev.date) && prev.date <= manifest.date ? prev.date
        : manifest.date;
  return {
    format: 'radar-backup-latest/v1',
    date: manifest.date,
    status: manifest.status,
    manifestKey,
    manifestSha256,
    pgKey: manifest.pg.key,
    pgSha256: manifest.pg.sha256,
    pgSizeBytes: manifest.pg.sizeBytes,
    docsObjects: Number.isFinite(manifest.docs.objects) ? manifest.docs.objects : (prev.docsObjects || null),
    inventoryKey: manifest.docs.inventoryKey || null,
    latestComplete,
    partialSince,
    partialReason: manifest.partialReason || null,
    firstBackupDate: isValidDate(prev.firstBackupDate) ? prev.firstBackupDate : manifest.date,
    updatedAt: manifest.completedAt,
  };
}

// ── S3 request deadlines ─────────────────────────────────────────────────────
// Error used as the abort reason of the docs copy (budget / SIGTERM).
function stoppedError(stop) {
  return Object.assign(new Error(`stopped: ${stop}`), { name: 'BackupStopped', stop });
}
function isStopped(e) { return !!e && e.name === 'BackupStopped'; }
function isRequestTimeout(e) { return !!e && (e.name === 'S3RequestTimeout' || e.name === 'TimeoutError'); }
// Wall-clock deadline of one command. kind 'meta' (HEAD/LIST/...) or 'body'
// (copy / write / transfer of `bytes`). After SIGTERM (ctx.finalDeadline) every
// deadline is capped so the final writes fit in the termination grace period.
function requestDeadlineMs(ctx, kind, bytes, nowMs = Date.now()) {
  const t = (ctx.cfg && ctx.cfg.timeouts) || DEFAULT_TIMEOUTS;
  let ms = kind === 'meta' ? t.metaMs : Math.max(t.requestMs, Math.ceil((Number(bytes) || 0) / t.minBytesPerSec * 1000));
  if (ctx.finalDeadline) ms = Math.max(1000, Math.min(ms, ctx.finalDeadline - nowMs));
  return ms;
}
// ctx.s3.send(cmd) with a deadline: the SDK gets an AbortSignal (it aborts the
// HTTP request and stops retrying) AND the returned promise settles on that
// signal whatever the SDK does, so a request that never answers cannot block.
// `consume(out, signal)` (a body read) runs under the same deadline. `signal`
// (optional) aborts the command early with its reason (docs budget / SIGTERM).
async function s3send(ctx, cmd, { kind = 'meta', bytes = 0, signal = null, consume = null } = {}) {
  const ms = requestDeadlineMs(ctx, kind, bytes);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(Object.assign(new Error(`S3 request exceeded ${ms} ms`), { name: 'S3RequestTimeout' })), ms);
  const onParent = () => ac.abort(signal.reason);
  if (signal) {
    if (signal.aborted) onParent();
    else signal.addEventListener('abort', onParent, { once: true });
  }
  try {
    if (ac.signal.aborted) throw ac.signal.reason;
    return await new Promise((resolve, reject) => {
      ac.signal.addEventListener('abort', () => reject(ac.signal.reason), { once: true });
      Promise.resolve()
        .then(() => ctx.s3.send(cmd, { abortSignal: ac.signal }))
        .then((out) => (consume ? consume(out, ac.signal) : out))
        .then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParent);
  }
}
// Reads a response body chunk by chunk; the stream is destroyed on abort.
async function readBody(body, signal, onChunk) {
  if (!body) return;
  if (Buffer.isBuffer(body) || typeof body === 'string') { onChunk(Buffer.from(body)); return; }
  const onAbort = () => { if (typeof body.destroy === 'function') body.destroy(signal.reason); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const c of body) onChunk(Buffer.isBuffer(c) ? c : Buffer.from(c));
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
// Transport-level bounds for the real client (main()). @smithy/node-http-handler is
// a dependency of @aws-sdk/client-s3, hoisted in /workspace/node_modules of the
// radar-api image (NODE_PATH). Only `connectionTimeout` + `socketTimeout` are
// passed: both are honoured by the 2.x..4.x handlers (4.x `requestTimeout` only
// warns), and neither logs a URL. The wall-clock bound never depends on it:
// s3send() enforces it in every mode.
function buildRequestHandler(timeouts, load = require) {
  try {
    const { NodeHttpHandler } = load('@smithy/node-http-handler');
    if (typeof NodeHttpHandler !== 'function') throw new Error('no NodeHttpHandler');
    return {
      requestHandler: new NodeHttpHandler({ connectionTimeout: timeouts.connectMs, socketTimeout: timeouts.requestMs }),
      mode: 'node-http-handler',
    };
  } catch {
    return { requestHandler: undefined, mode: 'abort-signal-only' };
  }
}

// ── S3 helpers (client + sdk injected: the selftest passes an in-memory fake) ─
async function hashFile(file) {
  const sha = crypto.createHash('sha256');
  const md5 = crypto.createHash('md5');
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) { sha.update(chunk); md5.update(chunk); size += chunk.length; }
  return { sha256: sha.digest('hex'), md5: md5.digest('base64'), size };
}
async function listAll(ctx, Bucket, Prefix, signal = ctx.signal) {
  const all = [];
  let ContinuationToken;
  do {
    const out = await s3send(ctx, new ctx.sdk.ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }), { signal });
    for (const o of out.Contents || []) all.push(o);
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return all;
}
// Latest version per key (needs s3:ListBucketVersions). A delete-marker as
// latest means "absent". Throws on AccessDenied; the caller falls back.
async function listLatestVersions(ctx, Bucket, Prefix, signal = ctx.signal) {
  const latest = new Map();
  let KeyMarker; let VersionIdMarker;
  do {
    const out = await s3send(ctx, new ctx.sdk.ListObjectVersionsCommand({ Bucket, Prefix, KeyMarker, VersionIdMarker }), { signal });
    for (const v of out.Versions || []) if (v.IsLatest) latest.set(v.Key, v);
    for (const m of out.DeleteMarkers || []) if (m.IsLatest) latest.delete(m.Key);
    const more = out.IsTruncated;
    KeyMarker = more ? out.NextKeyMarker : undefined;
    VersionIdMarker = more ? out.NextVersionIdMarker : undefined;
  } while (KeyMarker);
  return latest;
}
async function putBuffer(ctx, Key, body, ContentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const out = await s3send(ctx, new ctx.sdk.PutObjectCommand({
    Bucket: ctx.cfg.backupBucket, Key, Body: buf, ContentLength: buf.length,
    ContentMD5: crypto.createHash('md5').update(buf).digest('base64'), ContentType,
  }), { kind: 'body', bytes: buf.length, signal: ctx.signal });
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length, versionId: out.VersionId || null };
}
// Single PUT up to the threshold, multipart above. Content-MD5 on every body
// (object-lock buckets require an integrity header on writes).
async function putFile(ctx, Key, file, info) {
  const Bucket = ctx.cfg.backupBucket;
  const signal = ctx.signal;
  if (info.size <= ctx.cfg.multipartThreshold) {
    const out = await s3send(ctx, new ctx.sdk.PutObjectCommand({
      Bucket, Key, Body: fs.createReadStream(file), ContentLength: info.size, ContentMD5: info.md5,
      ContentType: 'application/octet-stream',
    }), { kind: 'body', bytes: info.size, signal });
    return { multipart: false, parts: 1, versionId: out.VersionId || null };
  }
  const { UploadId } = await s3send(ctx, new ctx.sdk.CreateMultipartUploadCommand({ Bucket, Key, ContentType: 'application/octet-stream' }), { signal });
  try {
    const parts = [];
    const fh = await fsp.open(file, 'r');
    try {
      for (let n = 1, pos = 0; pos < info.size; n += 1, pos += ctx.cfg.partSize) {
        const len = Math.min(ctx.cfg.partSize, info.size - pos);
        const buf = Buffer.alloc(len);
        let off = 0;
        while (off < len) {
          const { bytesRead } = await fh.read(buf, off, len - off, pos + off);
          if (!bytesRead) throw new BackupError(EXIT.RETRYABLE, 'short read on dump file');
          off += bytesRead;
        }
        const out = await s3send(ctx, new ctx.sdk.UploadPartCommand({
          Bucket, Key, UploadId, PartNumber: n, Body: buf, ContentLength: len,
          ContentMD5: crypto.createHash('md5').update(buf).digest('base64'),
        }), { kind: 'body', bytes: len, signal });
        parts.push({ PartNumber: n, ETag: out.ETag });
      }
    } finally {
      await fh.close();
    }
    const done = await s3send(ctx, new ctx.sdk.CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: parts } }),
      { kind: 'body', signal });
    return { multipart: true, parts: parts.length, versionId: done.VersionId || null };
  } catch (e) {
    // Not tied to `signal`: the upload is aborted even when the run was stopped.
    await s3send(ctx, new ctx.sdk.AbortMultipartUploadCommand({ Bucket, Key, UploadId })).catch(() => {});
    throw e;
  }
}
// Re-read AFTER upload: HEAD size + full GET re-hash. Mismatch = retryable failure.
async function verifyObject(ctx, Key, expected) {
  const Bucket = ctx.cfg.backupBucket;
  const head = await s3send(ctx, new ctx.sdk.HeadObjectCommand({ Bucket, Key }), { signal: ctx.signal });
  if (Number(head.ContentLength) !== expected.size) throw new BackupError(EXIT.RETRYABLE, `size mismatch after upload key=${Key}`);
  const h = crypto.createHash('sha256');
  let n = 0;
  const got = await s3send(ctx, new ctx.sdk.GetObjectCommand({ Bucket, Key }), {
    kind: 'body', bytes: expected.size, signal: ctx.signal,
    consume: async (out, sig) => { await readBody(out.Body, sig, (chunk) => { h.update(chunk); n += chunk.length; }); return out; },
  });
  const sha256 = h.digest('hex');
  if (sha256 !== expected.sha256 || n !== expected.size) throw new BackupError(EXIT.RETRYABLE, `sha256 mismatch after upload key=${Key}`);
  return { sha256, versionId: head.VersionId || got.VersionId || null };
}
// null when absent (first run) or unparsable (a corrupt pointer must not block
// every later backup; the relative size check is then skipped for one run).
async function getJsonOrNull(ctx, Key) {
  let text;
  try {
    const chunks = [];
    await s3send(ctx, new ctx.sdk.GetObjectCommand({ Bucket: ctx.cfg.backupBucket, Key }), {
      signal: ctx.signal, consume: (out, sig) => readBody(out.Body, sig, (c) => chunks.push(c)),
    });
    text = Buffer.concat(chunks).toString('utf8');
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch {
    ctx.log(`WARN ${Key} is not valid JSON; relative size check skipped for this run`);
    return null;
  }
}

async function checkVersioning(ctx) {
  try {
    const out = await s3send(ctx, new ctx.sdk.GetBucketVersioningCommand({ Bucket: ctx.cfg.backupBucket }), { signal: ctx.signal });
    if (out.Status !== 'Enabled') {
      throw new BackupError(EXIT.INTEGRITY, `backup bucket versioning is ${out.Status || 'off'} (must be Enabled)`);
    }
    return 'enabled';
  } catch (e) {
    if (e instanceof BackupError) throw e;
    if (isAccessDenied(e)) return 'unverified (no s3:GetBucketVersioning)';
    throw e;
  }
}

async function fetchServedSha(fetchImpl, url) {
  if (!url || typeof fetchImpl !== 'function') return 'unknown';
  try {
    const r = await fetchImpl(url, { signal: globalThis.AbortSignal.timeout(10000) });
    const j = await r.json();
    const sha = j && typeof j.sha === 'string' ? j.sha.trim() : '';
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function readOptional(file) {
  try { return await fsp.readFile(file, 'utf8'); } catch { return null; }
}

// ── docs step ────────────────────────────────────────────────────────────────
// srcObjs = the source listing taken (and guarded) before any write.
async function backupDocs(ctx, date, srcObjs) {
  const { cfg, log } = ctx;
  let dstIndex = new Map();
  let versionIds = 'list-versions';
  try {
    const latest = await listLatestVersions(ctx, cfg.backupBucket, LAYOUT.docsPrefix);
    for (const [k, v] of latest) dstIndex.set(k.slice(LAYOUT.docsPrefix.length), v);
  } catch (e) {
    if (!isAccessDenied(e)) throw e;
    versionIds = 'copy-only';
    dstIndex = new Map();
    for (const d of await listAll(ctx, cfg.backupBucket, LAYOUT.docsPrefix)) dstIndex.set(d.Key.slice(LAYOUT.docsPrefix.length), d);
  }
  const plan = planDocs(srcObjs, dstIndex, cfg.excludePrefixes);
  log(`docs source=${srcObjs.length} up_to_date=${plan.fresh.length} to_copy=${plan.todo.length} excluded=${plan.excluded.length} concurrency=${cfg.copyConcurrency} version_ids=${versionIds}`);
  // The budget really cuts: at the deadline (real timer, or the clock seen between
  // two copies) or on SIGTERM (ctx.terminate), `stop` aborts every copy in flight
  // and no worker starts a new one. An interrupted copy stays `pending`
  // (`interrupted`, retried next run). A copy past its request deadline (after the
  // SDK retries) stays `pending` too (`timedOut`); an S3 error answer is `failed`.
  const budgetMs = cfg.docsBudgetSeconds * 1000;
  const deadline = ctx.now() + budgetMs;
  const stop = new AbortController();
  const stopWith = (reason) => { if (!stop.signal.aborted) stop.abort(stoppedError(reason)); };
  const budgetTimer = setTimeout(() => stopWith('budget'), budgetMs);
  const onTerminate = () => stopWith('terminated');
  if (ctx.terminate) {
    if (ctx.terminate.aborted) onTerminate();
    else ctx.terminate.addEventListener('abort', onTerminate, { once: true });
  }
  const copied = new Map();
  const failed = new Set();
  let next = 0; let errorsLogged = 0; let timedOut = 0; let interrupted = 0;
  const worker = async () => {
    while (next < plan.todo.length) {
      if (stop.signal.aborted) return;
      if (ctx.now() >= deadline) { stopWith('budget'); return; }
      const o = plan.todo[next++];
      try {
        const out = await s3send(ctx, new ctx.sdk.CopyObjectCommand({
          Bucket: cfg.backupBucket, Key: LAYOUT.docsPrefix + o.Key,
          CopySource: '/' + cfg.sourceBucket + '/' + encodeKey(o.Key), MetadataDirective: 'COPY',
        }), { kind: 'body', bytes: Number(o.Size), signal: stop.signal });
        copied.set(o.Key, { etag: (out.CopyObjectResult && out.CopyObjectResult.ETag) || null, versionId: out.VersionId || null });
      } catch (e) {
        if (stop.signal.aborted && (e === stop.signal.reason || isStopped(e) || (e && e.name === 'AbortError'))) {
          interrupted += 1;
          continue;
        }
        if (isRequestTimeout(e)) {
          timedOut += 1; // stays pending: no answer is not an error answer
        } else {
          failed.add(o.Key);
        }
        if (errorsLogged < 5) { errorsLogged += 1; log(`docs copy error ${errName(e)} (object key not logged)`); }
      }
      const doneCount = copied.size + failed.size + timedOut;
      if (doneCount % 500 === 0) log(`docs progress ${doneCount}/${plan.todo.length}`);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(cfg.copyConcurrency, plan.todo.length) }, () => worker()));
  } finally {
    clearTimeout(budgetTimer);
    if (ctx.terminate) ctx.terminate.removeEventListener('abort', onTerminate);
  }
  const stopReason = stop.signal.aborted ? stop.signal.reason.stop : null;
  if (stopReason) log(`docs copy stopped reason=${stopReason} copied=${copied.size} failed=${failed.size} timed_out=${timedOut} interrupted=${interrupted} not_started=${plan.todo.length - next}`);
  const inventory = buildInventory({
    date, createdAt: new Date(ctx.now()).toISOString(), sourceBucket: cfg.sourceBucket, backupBucket: cfg.backupBucket,
    excludePrefixes: cfg.excludePrefixes, versionIds, srcObjs, dstIndex, copied, failed,
  });
  return { inventory, copied: copied.size, alreadyUpToDate: plan.fresh.length, budgetHit: stopReason === 'budget', stopReason, timedOut, interrupted, versionIds };
}

// ── retention: PLAN (backup step, writer: list only) ─────────────────────────
const PLAN_FILE = 'purge-plan.json';
const PLAN_FORMAT = 'radar-backup-purge-plan/v1';
async function planPurge(ctx, today) {
  const { cfg } = ctx;
  const byDate = new Map();
  const complete = new Set();
  for (const prefix of LAYOUT.datedPrefixes) {
    for (const o of await listAll(ctx, cfg.backupBucket, prefix)) {
      const c = classifyKey(o.Key);
      if (!c) continue;
      if (!byDate.has(c.date)) byDate.set(c.date, []);
      byDate.get(c.date).push(o.Key);
      if (c.kind === 'manifest') complete.add(c.date);
    }
  }
  if (!complete.has(today)) throw new BackupError(EXIT.PURGE_FAILED, 'purge plan refused: manifest of today is not listed');
  const plan = planRetention({ today, dates: [...byDate.keys()], completeDates: [...complete], ...cfg.retention });
  return {
    keptDates: plan.keep.length,
    purgedDates: plan.purge,
    keys: plan.purge.flatMap((d) => byDate.get(d)).sort(),
  };
}

// Validation the PURGE step applies to the plan before deleting anything. The
// plan comes from the writer step of the same pod; the purger re-checks it with
// its own retention floor (defence in depth).
function validatePurgePlan(plan, { today, dailyDays }) {
  if (!plan || plan.format !== PLAN_FORMAT) throw new BackupError(EXIT.PURGE_FAILED, 'purge refused: no valid purge plan (backup step incomplete)');
  if (!isValidDate(plan.date)) throw new BackupError(EXIT.PURGE_FAILED, 'purge refused: plan date invalid');
  if (Math.abs(dayNumber(today) - dayNumber(plan.date)) > 1) throw new BackupError(EXIT.PURGE_FAILED, 'purge refused: plan is not from this run');
  if (plan.backupStatus !== 'complete') return { run: false, keys: [] };
  if (!Array.isArray(plan.keys)) throw new BackupError(EXIT.PURGE_FAILED, 'purge refused: plan keys missing');
  const t = dayNumber(plan.date);
  for (const key of plan.keys) {
    const c = typeof key === 'string' ? classifyKey(key) : null;
    if (!c) throw new BackupError(EXIT.PURGE_FAILED, 'purge refused: plan holds a non-dated key');
    if (t - dayNumber(c.date) < dailyDays) throw new BackupError(EXIT.PURGE_FAILED, `purge refused: ${c.date} is inside the daily window`);
  }
  return { run: true, keys: plan.keys };
}

// ── retention: EXECUTE (purge step, purger identity: DeleteObject only) ──────
async function runPurge({ env, sdk, s3, now = Date.now, log = console.log }) {
  const cfg = readConfig(env, 'purge');
  assertBuckets(cfg);
  const today = new Date(now()).toISOString().slice(0, 10);
  const text = await readOptional(path.join(cfg.workDir, PLAN_FILE));
  let plan = null;
  try { plan = text === null ? null : JSON.parse(text); } catch { plan = null; }
  const v = validatePurgePlan(plan, { today, dailyDays: cfg.retention.dailyDays });
  if (!v.run) {
    log(`PURGE SKIPPED date=${plan.date} backup.status=${plan.backupStatus} (purge runs only after a complete backup)`);
    return { exitCode: EXIT.OK, deleteMarkers: 0, skipped: true };
  }
  const ctx = { cfg, sdk, s3, now, log };
  let deleteMarkers = 0;
  for (const Key of v.keys) {
    // NO VersionId: a delete-marker; the locked version stays until lifecycle expiry.
    if (!cfg.purgeDryRun) {
      try {
        await s3send(ctx, new sdk.DeleteObjectCommand({ Bucket: cfg.backupBucket, Key }));
      } catch (e) {
        throw new BackupError(EXIT.PURGE_FAILED, `purge failed after ${deleteMarkers} delete-markers: ${errName(e)}`);
      }
    }
    deleteMarkers += 1;
  }
  log(`PURGE OK date=${plan.date} kept_dates=${plan.keptDates} dates=${plan.purgedDates.length}` +
    `${plan.purgedDates.length ? '[' + plan.purgedDates.join(',') + ']' : ''} delete_markers=${deleteMarkers}${cfg.purgeDryRun ? ' dry_run=true' : ''}`);
  return { exitCode: EXIT.OK, deleteMarkers, skipped: false };
}

// ── freshness (reader identity) ──────────────────────────────────────────────
async function runFreshness({ env, sdk, s3, now = Date.now, log = console.log }) {
  const cfg = readConfig(env, 'freshness');
  assertBuckets(cfg);
  const ctx = { cfg, sdk, s3, now, log };
  const today = new Date(now()).toISOString().slice(0, 10);
  const latest = await getJsonOrNull(ctx, LAYOUT.latestKey);
  const f = checkFreshness({ today, latest, ...cfg.freshness });
  const reasons = [...f.reasons];
  if (latest && isValidDate(latest.date)) {
    // The pointer must match the objects it points to (manifest bytes, dump size).
    try {
      const h = crypto.createHash('sha256');
      await s3send(ctx, new sdk.GetObjectCommand({ Bucket: cfg.backupBucket, Key: latest.manifestKey }), {
        consume: (out, sig) => readBody(out.Body, sig, (c) => h.update(c)),
      });
      const sha = h.digest('hex');
      if (sha !== latest.manifestSha256) reasons.push(`manifest ${latest.manifestKey} sha256 differs from the pointer`);
    } catch (e) { reasons.push(`manifest ${latest.manifestKey} unreadable (${errName(e)})`); }
    try {
      const head = await s3send(ctx, new sdk.HeadObjectCommand({ Bucket: cfg.backupBucket, Key: latest.pgKey }));
      if (Number(head.ContentLength) !== Number(latest.pgSizeBytes)) reasons.push(`dump ${latest.pgKey} size differs from the pointer`);
    } catch (e) { reasons.push(`dump ${latest.pgKey} unreadable (${errName(e)})`); }
  }
  const lc = latest && latest.latestComplete ? latest.latestComplete.date : 'none';
  if (reasons.length) {
    log(`FRESHNESS FAIL today=${today} latest=${latest ? latest.date : 'none'} status=${latest ? latest.status : 'none'} latest_complete=${lc} reasons=${reasons.join('; ')}`);
    return { exitCode: EXIT.STALE, reasons };
  }
  log(`FRESHNESS OK today=${today} latest=${latest.date} status=${latest.status} latest_complete=${lc}`);
  return { exitCode: EXIT.OK, reasons };
}

// ── main flow ────────────────────────────────────────────────────────────────
// Backup step (writer identity). Never deletes: the retention is only PLANNED
// here (purge-plan.json in WORK_DIR) and executed by runPurge in the next step.
// `terminate` (AbortSignal, fired by main() on SIGTERM): before the PG part is
// recorded it aborts the run (exit 1, nothing to record); during the docs copy it
// stops the copy, and the inventory + manifest (partial) + latest.json are still
// written, each request capped to fit in the termination grace period.
async function runBackup({ env, sdk, s3, fetchImpl, now = Date.now, log = console.log, overrides = {}, terminate = null }) {
  const cfg = { ...readConfig(env, 'backup'), ...overrides };
  assertBuckets(cfg);
  const ctx = { cfg, sdk, s3, now, log, fetchImpl, terminate, signal: terminate, finalDeadline: null };
  const onTerminate = () => { ctx.finalDeadline = Date.now() + Math.max(5, cfg.terminationGraceSeconds - 10) * 1000; };
  if (terminate) {
    if (terminate.aborted) onTerminate();
    else terminate.addEventListener('abort', onTerminate, { once: true });
  }
  try {
    return await runBackupSteps(ctx);
  } catch (e) {
    // SIGTERM before the PG part was recorded: nothing valid to record.
    if (isStopped(e)) throw new BackupError(EXIT.RETRYABLE, 'terminated (SIGTERM) before the PG backup was recorded');
    throw e;
  } finally {
    if (terminate) terminate.removeEventListener('abort', onTerminate);
  }
}
async function runBackupSteps(ctx) {
  const { cfg, now, log, fetchImpl } = ctx;
  const W = cfg.workDir;

  // 1) facts left by the dump initContainer
  const facts = parseEnvFile(await readOptional(path.join(W, 'dump.env')));
  const date = facts.DATE;
  if (!isValidDate(date)) throw new BackupError(EXIT.INTEGRITY, 'dump.env has no valid DATE');
  if (facts.DATABASE && facts.DATABASE !== cfg.expectedDatabase) throw new BackupError(EXIT.INTEGRITY, 'dump.env DATABASE differs from EXPECTED_DATABASE');
  const keys = keysFor(date);
  const dumpFile = path.join(W, 'radar.dump');
  const shaLine = parseSha256Line(await readOptional(path.join(W, 'radar.dump.sha256')));
  if (!shaLine) throw new BackupError(EXIT.RETRYABLE, 'radar.dump.sha256 missing or unreadable');
  let info;
  try { info = await hashFile(dumpFile); } catch { throw new BackupError(EXIT.RETRYABLE, 'radar.dump missing or unreadable'); }
  if (info.sha256 !== shaLine.sha256) throw new BackupError(EXIT.RETRYABLE, 'local sha256 disagrees with sha256sum of the dump');
  log(`pg dump date=${date} bytes=${info.size} sha256=${info.sha256} toc_entries=${facts.TOC_ENTRIES || 'unknown'}`);

  // 2) bucket + size guards BEFORE any write
  const versioning = await checkVersioning(ctx);
  const previous = await getJsonOrNull(ctx, LAYOUT.latestKey);
  const size = checkDumpSize({ size: info.size, previousSize: previous && previous.pgSizeBytes, minBytes: cfg.minDumpBytes, minRatio: cfg.minDumpRatio });
  if (!size.ok) throw new BackupError(EXIT.INTEGRITY, `dump size anomaly: ${size.reason}`);
  // Docs source listed (after the dump, before any write) and guarded against an
  // empty/collapsed listing. A listing ERROR is not a refusal: the PG backup is
  // still recorded, the docs part is marked incomplete (exit 4).
  let srcObjs = null; let sourceError = null;
  try { srcObjs = await listAll(ctx, cfg.sourceBucket, undefined); } catch (e) { sourceError = e; }
  if (srcObjs) {
    const src = checkDocsSource({ count: srcObjs.length, previousCount: previous && previous.docsObjects, minRatio: cfg.minDocsRatio });
    if (!src.ok) throw new BackupError(EXIT.INTEGRITY, `docs source anomaly: ${src.reason}`);
  }

  // 3) PG upload + re-read
  const up = await putFile(ctx, keys.dump, dumpFile, info);
  const reread = await verifyObject(ctx, keys.dump, info);
  const shaText = `${info.sha256}  radar.dump\n`;
  const shaObj = await putBuffer(ctx, keys.dumpSha, shaText, 'text/plain');
  await verifyObject(ctx, keys.dumpSha, shaObj);
  log(`pg uploaded key=${keys.dump} multipart=${up.multipart} parts=${up.parts} reread_sha256=ok`);

  let globals = { status: facts.GLOBALS_STATUS === 'ok' ? 'ok' : 'failed' };
  const globalsText = globals.status === 'ok' ? await readOptional(path.join(W, 'globals.sql')) : null;
  if (globalsText !== null && globals.status === 'ok') {
    const g = await putBuffer(ctx, keys.globals, globalsText, 'application/sql');
    await verifyObject(ctx, keys.globals, g);
    const gs = await putBuffer(ctx, keys.globalsSha, `${g.sha256}  globals.sql\n`, 'text/plain');
    await verifyObject(ctx, keys.globalsSha, gs);
    globals = { status: 'ok', key: keys.globals, sha256Key: keys.globalsSha, sha256: g.sha256, sizeBytes: g.size, rolePasswords: 'excluded' };
  } else {
    globals = { status: 'failed' };
  }

  // 4) schema version (from the dump itself) + served code sha
  const migrations = parseMigrationsCopy(await readOptional(path.join(W, 'migrations.sql')));
  let journal = null;
  if (cfg.drizzleJournal) { try { journal = JSON.parse(await fsp.readFile(cfg.drizzleJournal, 'utf8')); } catch { journal = null; } }
  const schema = migrations
    ? {
        status: 'ok',
        source: 'dump: drizzle.__drizzle_migrations',
        migrationsApplied: migrations.migrationsApplied,
        lastMigration: migrations.lastMigration
          ? { ...migrations.lastMigration, tag: resolveMigrationTag(migrations.lastMigration.createdAt, journal) }
          : null,
      }
    : { status: 'unknown', source: 'dump: drizzle.__drizzle_migrations' };
  const servedSha = await fetchServedSha(fetchImpl, cfg.publicHealthUrl);

  // 5) docs (a docs error still records the PG backup: status=incomplete, exit 4;
  //    pending objects left by the budget, a request deadline or SIGTERM = partial,
  //    resumed next run). From here on the PG part is recorded: whatever stops the
  //    copy, the inventory, the manifest and latest.json are written.
  let docs;
  let d = null;
  try {
    if (sourceError) throw sourceError;
    d = await backupDocs(ctx, date, srcObjs);
  } catch (e) {
    if (e instanceof BackupError) throw e;
    log(`docs step failed ${errName(e)}`);
    docs = { status: docsStatus(null, e), sourceBucket: cfg.sourceBucket, backupPrefix: LAYOUT.docsPrefix, error: errName(e), inventoryKey: null };
  }
  // Final writes: no longer aborted by SIGTERM (only bounded, see s3send).
  ctx.signal = null;
  const finalStarted = Date.now();
  let inventoryBytes = 0;
  if (d) {
    let inv = null; let inventoryError = null;
    try {
      const text = JSON.stringify(d.inventory);
      inventoryBytes = Buffer.byteLength(text);
      inv = await putBuffer(ctx, keys.inventory, text, 'application/json');
    } catch (e) {
      inventoryError = errName(e);
      log(`docs inventory not written ${inventoryError}`);
    }
    const c = d.inventory.counts;
    docs = {
      status: docsStatus(c, null, !!inv),
      sourceBucket: cfg.sourceBucket,
      backupPrefix: LAYOUT.docsPrefix,
      objects: c.objects,
      totalBytes: c.totalBytes,
      backedUp: c.backedUp,
      copied: d.copied,
      alreadyUpToDate: d.alreadyUpToDate,
      pending: c.pending,
      failed: c.failed,
      excluded: c.excluded,
      excludedPrefixes: cfg.excludePrefixes,
      budgetExhausted: d.budgetHit,
      stopReason: d.stopReason,
      timedOut: d.timedOut,
      interrupted: d.interrupted,
      sourceGuard: { previousObjects: (previous && previous.docsObjects) || null, minRatio: cfg.minDocsRatio },
      versionIds: d.versionIds,
      inventoryKey: inv ? keys.inventory : null,
      inventorySha256: inv ? inv.sha256 : null,
      ...(inventoryError ? { inventoryError } : {}),
    };
  }

  // 6) manifest + latest pointer
  const completedAt = new Date(now()).toISOString();
  const scriptSha256 = crypto.createHash('sha256').update(await fsp.readFile(__filename)).digest('hex');
  const manifest = buildManifest({
    date,
    startedAt: facts.STARTED_AT || null,
    completedAt,
    cfg,
    pg: {
      database: facts.DATABASE || cfg.expectedDatabase,
      format: 'pg_dump custom (-Fc), --no-owner --no-privileges',
      key: keys.dump,
      sha256Key: keys.dumpSha,
      sha256: info.sha256,
      sizeBytes: info.size,
      multipart: up.multipart,
      versionId: up.versionId || reread.versionId || null,
      tocEntries: facts.TOC_ENTRIES ? Number(facts.TOC_ENTRIES) : null,
      dumpStartedAt: facts.STARTED_AT || null,
      dumpFinishedAt: facts.FINISHED_AT || null,
      serverVersion: facts.SERVER_VERSION || null,
      postgisVersion: facts.POSTGIS_VERSION || null,
      pgDumpVersion: facts.PG_DUMP_VERSION || null,
      checks: {
        tocListedBeforeUpload: Number(facts.TOC_ENTRIES) > 0,
        sha256RereadAfterUpload: true,
        sizeFloorBytes: cfg.minDumpBytes,
        sizeRatioVsPrevious: cfg.minDumpRatio,
        previousSizeBytes: (previous && previous.pgSizeBytes) || null,
      },
      globals,
    },
    schema,
    code: { servedSha, source: cfg.publicHealthUrl || null },
    docs,
    tool: { script: 'deploy/ci/backup/backup-daily.cjs', scriptSha256, image: cfg.backupImage, bucketVersioning: versioning },
  });
  const man = await putBuffer(ctx, keys.manifest, JSON.stringify(manifest, null, 2), 'application/json');
  const pointer = buildLatestPointer(manifest, keys.manifest, man.sha256, previous);
  await putBuffer(ctx, LAYOUT.latestKey, JSON.stringify(pointer, null, 2), 'application/json');
  log(`final writes ms=${Date.now() - finalStarted} inventory.bytes=${inventoryBytes} (inventory + manifest + latest.json; grace ${cfg.terminationGraceSeconds} s)`);

  // 7) retention PLAN for the purge step (only a complete backup gets a non-empty
  //    plan; a partial/incomplete day writes a skip plan). No delete here.
  //    Not after SIGTERM: the pod is going away, the purge container will not run.
  const terminated = !!(ctx.terminate && ctx.terminate.aborted);
  const plan = { format: PLAN_FORMAT, date, backupStatus: manifest.status, manifestKey: keys.manifest, manifestSha256: man.sha256,
    retention: cfg.retention, keptDates: null, purgedDates: [], keys: [] };
  if (!terminated) {
    if (manifest.status === 'complete') Object.assign(plan, await planPurge(ctx, date));
    await fsp.writeFile(path.join(W, PLAN_FILE), JSON.stringify(plan));
  }

  const verdict = terminated ? 'TERMINATED' : { complete: 'OK', partial: 'PARTIAL', incomplete: 'INCOMPLETE' }[manifest.status];
  const na = (v) => (v === undefined ? 'n/a' : v);
  log(`VERDICT ${verdict} date=${date} status=${manifest.status} pg.bytes=${info.size} pg.sha256=${info.sha256} ` +
    `schema.migrations=${schema.migrationsApplied === undefined ? 'unknown' : schema.migrationsApplied} code.sha=${servedSha} ` +
    `docs.status=${docs.status} docs.objects=${na(docs.objects)} docs.copied=${na(docs.copied)} ` +
    `docs.pending=${na(docs.pending)} docs.failed=${na(docs.failed)} docs.timed_out=${na(docs.timedOut)} docs.stop=${docs.stopReason || 'none'} ` +
    `manifest=${keys.manifest} manifest.sha256=${man.sha256} ` +
    `latest_complete=${pointer.latestComplete ? pointer.latestComplete.date : 'none'} ` +
    `${terminated ? 'purge=skipped(terminated)' : `purge.planned_dates=${plan.purgedDates.length}`}` +
    `${manifest.partialReason ? ` reason="${manifest.partialReason}"` : ''}`);
  // SIGTERM: recorded (partial), but the run did not finish → exit 1 (retryable;
  // on activeDeadlineSeconds the Job is failed anyway, with its manifest written).
  const exitCode = terminated ? EXIT.RETRYABLE : manifest.status === 'incomplete' ? EXIT.DOCS_INCOMPLETE : EXIT.OK;
  return { exitCode, manifest, pointer, plan: terminated ? null : plan };
}

function makeClient(sdk, cfg, requestHandler) {
  return new sdk.S3Client({
    ...(requestHandler ? { requestHandler } : {}),
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    maxAttempts: 5,
    // Plain PUTs with our own Content-MD5 (no aws-chunked trailers): the most
    // portable form for S3-compatible providers and object-lock buckets.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

async function main(mode) {
  if (!['backup', 'purge', 'freshness'].includes(mode)) throw new BackupError(EXIT.INTEGRITY, `unknown mode ${mode}`);
  // Lazy: resolved from the radar-api image (NODE_PATH=/workspace/node_modules); the selftest never loads it.
  const sdk = require('@aws-sdk/client-s3');
  const cfg = readConfig(process.env, mode);
  const log = (m) => console.log(`[${mode}] ${m}`);
  const handler = buildRequestHandler(cfg.timeouts);
  const t = cfg.timeouts;
  log(`s3 timeouts connect_ms=${t.connectMs} request_ms=${t.requestMs} meta_ms=${t.metaMs} min_bytes_per_sec=${t.minBytesPerSec} handler=${handler.mode}` +
    `${mode === 'backup' ? ` docs_budget_s=${cfg.docsBudgetSeconds} grace_s=${cfg.terminationGraceSeconds}` : ''}`);
  const s3 = makeClient(sdk, cfg, handler.requestHandler);
  // SIGTERM (kubelet, on activeDeadlineSeconds or a node drain; SIGKILL follows
  // after terminationGracePeriodSeconds): mode `backup` stops the copy and still
  // records the day (inventory, manifest partial, latest.json). Other modes keep
  // the default behaviour (exit on SIGTERM): they write nothing to preserve.
  const terminate = new AbortController();
  if (mode === 'backup') {
    process.once('SIGTERM', () => {
      log('SIGTERM received: stopping the copy, recording a partial backup');
      terminate.abort(stoppedError('terminated'));
    });
  }
  const run = { backup: runBackup, purge: runPurge, freshness: runFreshness }[mode];
  const r = await run({ env: process.env, sdk, s3, fetchImpl: globalThis.fetch, log, terminate: terminate.signal });
  return r.exitCode;
}
module.exports = {
  EXIT, BackupError, LAYOUT, PLAN_FILE, PLAN_FORMAT, keysFor, classifyKey, dayNumber, isValidDate, isoWeekIndex,
  monthIndex, weekdayUtc, planRetention, parseEnvFile, parseSha256Line, parseMigrationsCopy, resolveMigrationTag,
  parsePrefixes, withScheme, encodeKey, checkDumpSize, checkDocsSource, docsStatus, checkFreshness, upToDate, planDocs,
  buildInventory, readConfig, assertBuckets, buildManifest, buildLatestPointer, validatePurgePlan, runBackup, runPurge,
  runFreshness,
  DEFAULT_TIMEOUTS, readTimeouts, requestDeadlineMs, s3send, buildRequestHandler, partialReasonOf, stoppedError,
};

if (require.main === module) {
  const mode = process.argv[2] || 'backup';
  main(mode).then((code) => process.exit(code)).catch((e) => {
    const code = e instanceof BackupError ? e.exitCode : EXIT.RETRYABLE;
    const msg = e instanceof BackupError ? e.message : errName(e);
    console.error(`[${mode}] VERDICT FAIL exit=${code} ${msg}`);
    process.exit(code);
  });
}
