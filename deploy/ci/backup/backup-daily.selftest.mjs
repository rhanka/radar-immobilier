#!/usr/bin/env node
// =============================================================================
// backup-daily.selftest.mjs — self-test of deploy/ci/backup/backup-daily.cjs.
//
// 0 network, 0 cluster, 0 real S3, 0 DB: pure helpers + the full runBackup flow
// against an in-memory VERSIONED S3 fake (delete-markers, ListObjectVersions,
// multipart, Content-MD5 verification, pagination), plus static checks of the
// CronJob / SealedSecrets / RBAC / CD wiring.
//
//   node deploy/ci/backup/backup-daily.selftest.mjs   → exit 0 when all pass.
// =============================================================================
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const lib = require('./backup-daily.cjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); } else { failed += 1; console.log(`  FAIL ${name}`); }
};
const eq = (name, a, b) => ok(`${name}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`, JSON.stringify(a) === JSON.stringify(b));
const throwsCode = (name, fn, code) => {
  try { fn(); ok(`${name} (did not throw)`, false); } catch (e) { eq(name, e.exitCode, code); }
};

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const md5hex = (b) => crypto.createHash('md5').update(b).digest('hex');
const md5b64 = (b) => crypto.createHash('md5').update(b).digest('base64');
const addDays = (d, n) => new Date(lib.dayNumber(d) * 86400000 + n * 86400000).toISOString().slice(0, 10);
const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

// ── fake AWS SDK (command classes named like the real ones) ──────────────────
const OPS = ['PutObject', 'GetObject', 'HeadObject', 'ListObjectsV2', 'ListObjectVersions', 'CopyObject', 'DeleteObject',
  'GetBucketVersioning', 'CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload', 'AbortMultipartUpload'];
const sdk = Object.fromEntries(OPS.map((op) => {
  const name = `${op}Command`;
  return [name, ({ [name]: class { constructor(input) { this.input = input; } } })[name]];
}));
// Per-identity SDK views: a step that tries a command its identity lacks throws
// (TypeError: not a constructor) → the test fails. This PROVES, by construction:
//   backup (writer)  cannot issue any delete;
//   purge  (purger)  needs nothing but DeleteObject (no List/Get);
//   freshness (reader) only reads.
const sdkWriter = Object.fromEntries(Object.entries(sdk).filter(([k]) => k !== 'DeleteObjectCommand'));
const sdkPurger = { DeleteObjectCommand: sdk.DeleteObjectCommand };
const sdkReader = { GetObjectCommand: sdk.GetObjectCommand, HeadObjectCommand: sdk.HeadObjectCommand };
const s3err = (name, status) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
async function toBuf(body) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  const chunks = [];
  for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

class FakeS3 {
  constructor(clock, pageSize = 3) {
    this.clock = clock; this.pageSize = pageSize; this.buckets = new Map(); this.calls = []; this.hooks = {}; this.seq = 0; this.uploads = new Map();
  }
  bucket(name, versioning = 'Enabled') { this.buckets.set(name, { versioning, keys: new Map() }); return this; }
  b(name) { const b = this.buckets.get(name); if (!b) throw s3err('NoSuchBucket', 404); return b; }
  latest(b, key) { const v = b.keys.get(key); if (!v || !v.length) return null; const l = v[v.length - 1]; return l.deleteMarker ? null : l; }
  write(bucket, key, body, etag) {
    const b = this.b(bucket);
    const ver = { id: b.versioning === 'Enabled' ? `v${++this.seq}` : 'null', body, etag: etag || `"${md5hex(body)}"`, lastModified: new Date(this.clock.now()), deleteMarker: false };
    if (b.versioning !== 'Enabled' || !b.keys.has(key)) b.keys.set(key, [ver]); else b.keys.get(key).push(ver);
    return ver;
  }
  seed(bucket, key, body) { return this.write(bucket, key, Buffer.from(body)); }
  current(bucket, prefix) {
    const b = this.b(bucket);
    return [...b.keys.keys()].sort().filter((k) => !prefix || k.startsWith(prefix))
      .map((k) => [k, this.latest(b, k)]).filter(([, l]) => l)
      .map(([k, l]) => ({ Key: k, Size: l.body.length, ETag: l.etag, LastModified: l.lastModified }));
  }
  text(bucket, key) { const l = this.latest(this.b(bucket), key); return l ? l.body.toString('utf8') : null; }
  async send(cmd) {
    const op = cmd.constructor.name.replace(/Command$/, '');
    this.calls.push({ op, input: cmd.input });
    if (this.hooks[op]) {
      const r = await this.hooks[op](cmd.input);
      if (r instanceof Error) throw r;
      if (r !== undefined) return r;
    }
    return this[`op${op}`](cmd.input);
  }
  async opPutObject({ Bucket, Key, Body, ContentMD5, ContentLength }) {
    const body = await toBuf(Body);
    if (ContentLength !== undefined && ContentLength !== body.length) throw s3err('IncompleteBody', 400);
    if (!ContentMD5 || ContentMD5 !== md5b64(body)) throw s3err('BadDigest', 400); // object-lock: integrity header required
    const v = this.write(Bucket, Key, body);
    return { ETag: v.etag, VersionId: v.id };
  }
  async opGetObject({ Bucket, Key }) {
    const l = this.latest(this.b(Bucket), Key);
    if (!l) throw s3err('NoSuchKey', 404);
    return { Body: Readable.from([l.body]), ContentLength: l.body.length, ETag: l.etag, VersionId: l.id };
  }
  async opHeadObject({ Bucket, Key }) {
    const l = this.latest(this.b(Bucket), Key);
    if (!l) throw s3err('NotFound', 404);
    return { ContentLength: l.body.length, ETag: l.etag, VersionId: l.id };
  }
  async opListObjectsV2({ Bucket, Prefix, ContinuationToken }) {
    const all = this.current(Bucket, Prefix);
    const start = ContinuationToken ? Number(ContinuationToken) : 0;
    const more = start + this.pageSize < all.length;
    return { Contents: all.slice(start, start + this.pageSize), IsTruncated: more, NextContinuationToken: more ? String(start + this.pageSize) : undefined };
  }
  async opListObjectVersions({ Bucket, Prefix, KeyMarker, VersionIdMarker }) {
    const b = this.b(Bucket);
    const flat = [];
    for (const k of [...b.keys.keys()].sort()) {
      if (Prefix && !k.startsWith(Prefix)) continue;
      const vs = b.keys.get(k);
      for (let i = vs.length - 1; i >= 0; i -= 1) flat.push({ k, v: vs[i], latest: i === vs.length - 1 });
    }
    const start = KeyMarker ? flat.findIndex((x) => x.k === KeyMarker && x.v.id === VersionIdMarker) + 1 : 0;
    const page = flat.slice(start, start + this.pageSize);
    const more = start + this.pageSize < flat.length;
    const last = page[page.length - 1];
    return {
      Versions: page.filter((x) => !x.v.deleteMarker).map((x) => ({ Key: x.k, VersionId: x.v.id, IsLatest: x.latest, Size: x.v.body.length, ETag: x.v.etag, LastModified: x.v.lastModified })),
      DeleteMarkers: page.filter((x) => x.v.deleteMarker).map((x) => ({ Key: x.k, VersionId: x.v.id, IsLatest: x.latest })),
      IsTruncated: more, NextKeyMarker: more ? last.k : undefined, NextVersionIdMarker: more ? last.v.id : undefined,
    };
  }
  async opCopyObject({ Bucket, Key, CopySource }) {
    const m = /^\/([^/]+)\/(.*)$/.exec(CopySource);
    const l = this.latest(this.b(m[1]), decodeURIComponent(m[2]));
    if (!l) throw s3err('NoSuchKey', 404);
    const v = this.write(Bucket, Key, l.body, l.etag);
    return { CopyObjectResult: { ETag: v.etag, LastModified: v.lastModified }, VersionId: v.id };
  }
  async opDeleteObject({ Bucket, Key, VersionId }) {
    if (VersionId) throw s3err('AccessDenied', 403); // the writer has NO s3:DeleteObjectVersion
    const b = this.b(Bucket);
    if (b.versioning === 'Enabled') {
      if (!b.keys.has(Key)) b.keys.set(Key, []);
      b.keys.get(Key).push({ id: `dm${++this.seq}`, deleteMarker: true, body: Buffer.alloc(0), lastModified: new Date(this.clock.now()) });
    } else b.keys.delete(Key);
    return {};
  }
  async opGetBucketVersioning({ Bucket }) { const b = this.b(Bucket); return b.versioning === 'Off' ? {} : { Status: b.versioning }; }
  async opCreateMultipartUpload({ Bucket, Key }) { const id = `up${++this.seq}`; this.uploads.set(id, { Bucket, Key, parts: new Map() }); return { UploadId: id }; }
  async opUploadPart({ UploadId, PartNumber, Body, ContentMD5 }) {
    const body = await toBuf(Body);
    if (ContentMD5 !== md5b64(body)) throw s3err('BadDigest', 400);
    this.uploads.get(UploadId).parts.set(PartNumber, body);
    return { ETag: `"${md5hex(body)}"` };
  }
  async opCompleteMultipartUpload({ Bucket, Key, UploadId, MultipartUpload }) {
    const u = this.uploads.get(UploadId);
    const bufs = MultipartUpload.Parts.map((p) => u.parts.get(p.PartNumber));
    const etag = `"${md5hex(Buffer.concat(bufs.map((x) => crypto.createHash('md5').update(x).digest())))}-${bufs.length}"`;
    const v = this.write(Bucket, Key, Buffer.concat(bufs), etag);
    this.uploads.delete(UploadId);
    return { ETag: v.etag, VersionId: v.id };
  }
  async opAbortMultipartUpload({ UploadId }) { this.uploads.delete(UploadId); return {}; }
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const BK = 'radar-immobilier-backup';
const DOCS = 'radar-immobilier-docs';
const MIGRATIONS_SQL = [
  '--', '-- PostgreSQL database dump', '--', '', 'SET statement_timeout = 0;', '',
  '--', '-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: -', '--', '',
  'COPY drizzle.__drizzle_migrations (id, hash, created_at) FROM stdin;',
  `2\t${'b'.repeat(64)}\t1780000000000`,
  `1\t${'a'.repeat(64)}\t1779659626580`,
  `3\t${'c'.repeat(64)}\t1749524400000`,
  '\\.', '', '--', '-- PostgreSQL database dump complete', '--', '',
].join('\n');
const JOURNAL = { entries: [
  { idx: 0, when: 1779659626580, tag: '0000_superb_surge' },
  { idx: 1, when: 1780000000000, tag: '0001_wp5v1_ontology_bitemporal' },
  { idx: 2, when: 1749524400000, tag: '0002_graph_store' },
] };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-backup-selftest-'));
const JOURNAL_PATH = path.join(TMP, '_journal.json');
fs.writeFileSync(JOURNAL_PATH, JSON.stringify(JOURNAL));
// Doc keys chosen to be recognisable: none of these fragments may ever appear in logs.
const DOC_KEYS = ['raw/ville-a/pv 2026-01-15.pdf', 'raw/ville-b/procès-verbal.pdf', 'graph/canonical/state.json',
  'raw/ville-c/a.pdf', 'raw/ville-c/b.pdf', 'archive/2019/big.pdf', 'raw/ville-d/x.pdf'];
const LEAK_MARKERS = ['ville-', 'canonical', 'procès', 'archive/2019', 'AKFAKE', 'SKFAKE'];

let workSeq = 0;
function makeWork(date, { bytes = 300 * 1024, globals = true, migrations = true } = {}) {
  const dir = path.join(TMP, `work-${++workSeq}`);
  fs.mkdirSync(dir);
  const dump = crypto.randomBytes(bytes);
  fs.writeFileSync(path.join(dir, 'radar.dump'), dump);
  fs.writeFileSync(path.join(dir, 'radar.dump.sha256'), `${sha(dump)}  radar.dump\n`);
  fs.writeFileSync(path.join(dir, 'dump.env'), [
    `DATE=${date}`, `STARTED_AT=${date}T02:23:05Z`, `FINISHED_AT=${date}T02:25:40Z`, 'DATABASE=radar',
    'SERVER_VERSION=16.4 (Debian 16.4-1.pgdg120+2)', 'POSTGIS_VERSION=3.4.3',
    'PG_DUMP_VERSION=pg_dump (PostgreSQL) 16.4 (Debian 16.4-1.pgdg120+2)', 'TOC_ENTRIES=812',
    `GLOBALS_STATUS=${globals ? 'ok' : 'failed'}`, '',
  ].join('\n'));
  if (migrations) fs.writeFileSync(path.join(dir, 'migrations.sql'), MIGRATIONS_SQL);
  if (globals) fs.writeFileSync(path.join(dir, 'globals.sql'), '--\n-- PostgreSQL database cluster dump\n--\nCREATE ROLE radar_db_ro_prod;\n');
  return { dir, dump };
}
const envFor = (dir, extra = {}) => ({
  S3_ENDPOINT: 's3.bhs.io.cloud.ovh.net', S3_REGION: 'bhs', S3_ACCESS_KEY: 'AKFAKE', S3_SECRET_KEY: 'SKFAKE',
  BACKUP_BUCKET: BK, SOURCE_DOCS_BUCKET: DOCS, EXPECTED_BACKUP_BUCKET: BK, EXPECTED_SOURCE_DOCS_BUCKET: DOCS,
  WORK_DIR: dir, PUBLIC_HEALTH_URL: 'https://immo.example/health', DRIZZLE_JOURNAL: JOURNAL_PATH,
  BACKUP_IMAGE: 'ghcr.io/example/radar-api@sha256:test', MIN_DUMP_BYTES: '1000', ...extra,
});
const okFetch = async () => ({ json: async () => ({ status: 'ok', sha: 'abc1234', db: { ok: true } }) });
const mkClock = (iso) => ({ t: Date.parse(iso), now() { return this.t; } });

function mkWorld(iso = '2026-09-26T02:20:00Z') {
  const clock = mkClock(iso);
  const fake = new FakeS3(clock).bucket(BK, 'Enabled').bucket(DOCS, 'Off');
  clock.t -= 86400000 * 3; // source docs written 3 days earlier
  DOC_KEYS.forEach((k, i) => fake.seed(DOCS, k, `doc-${i}-${'x'.repeat(40 + i)}`));
  clock.t += 86400000; // backup copies of 2 docs written after the source writes
  fake.seed(BK, 'docs/raw/ville-c/a.pdf', 'doc-3-' + 'x'.repeat(43)); // identical → up to date
  fake.seed(BK, 'docs/raw/ville-c/b.pdf', 'stale'); // different size → recopied
  clock.t = Date.parse(iso);
  return { clock, fake };
}
const purgerEnv = (dir, extra = {}) => ({
  S3_ENDPOINT: 's3.bhs.io.cloud.ovh.net', S3_REGION: 'bhs', S3_ACCESS_KEY: 'AKFAKE', S3_SECRET_KEY: 'SKFAKE',
  BACKUP_BUCKET: BK, EXPECTED_BACKUP_BUCKET: BK, WORK_DIR: dir, ...extra,
});
const readerEnv = (extra = {}) => ({
  S3_ENDPOINT: 's3.bhs.io.cloud.ovh.net', S3_REGION: 'bhs', S3_ACCESS_KEY: 'AKFAKE', S3_SECRET_KEY: 'SKFAKE',
  BACKUP_BUCKET: BK, EXPECTED_BACKUP_BUCKET: BK, ...extra,
});
async function capture(fn) {
  const logs = [];
  try {
    const r = await fn((m) => logs.push(m));
    return { code: r.exitCode, r, logs };
  } catch (e) {
    return { code: e instanceof lib.BackupError ? e.exitCode : `unexpected:${e && e.stack}`, err: e, logs };
  }
}
// backup step = writer identity (sdkWriter: no DeleteObjectCommand at all)
const run = (fake, clock, env, { overrides, fetchImpl = okFetch } = {}) =>
  capture((log) => lib.runBackup({ env, sdk: sdkWriter, s3: fake, fetchImpl, now: () => clock.now(), log, overrides }));
// purge step = purger identity (sdkPurger: DeleteObjectCommand only)
const runPurge = (fake, clock, dir, extra) =>
  capture((log) => lib.runPurge({ env: purgerEnv(dir, extra), sdk: sdkPurger, s3: fake, now: () => clock.now(), log }));
// freshness = reader identity (sdkReader: Get/Head only)
const runFresh = (fake, clock, extra) =>
  capture((log) => lib.runFreshness({ env: readerEnv(extra), sdk: sdkReader, s3: fake, now: () => clock.now(), log }));
const deletes = (fake) => fake.calls.filter((c) => c.op === 'DeleteObject');
const readPlan = (dir) => JSON.parse(fs.readFileSync(path.join(dir, lib.PLAN_FILE), 'utf8'));
const noLeak = (name, logs, extra = '') => {
  const text = logs.join('\n') + extra;
  ok(`${name} — no doc key / credential in logs`, LEAK_MARKERS.every((m) => !text.includes(m)));
};

// ═════════════════════════════════════════════════════════════════════════════
console.log('# dates / keys');
eq('dayNumber epoch', lib.dayNumber('1970-01-01'), 0);
ok('invalid dates rejected', ['2026-02-30', '2026-13-01', '26-09-01', 'x', ''].every((d) => !lib.isValidDate(d)));
eq('ISO week: Sun 1970-01-04 and Mon 1970-01-05 differ', [lib.isoWeekIndex('1970-01-04'), lib.isoWeekIndex('1970-01-05')], [0, 1]);
eq('2026-09-27 is a Sunday', lib.weekdayUtc('2026-09-27'), 0);
eq('keysFor layout', lib.keysFor('2026-09-26'), {
  dump: 'pg/2026-09-26/radar.dump', dumpSha: 'pg/2026-09-26/radar.dump.sha256', globals: 'pg/2026-09-26/globals.sql',
  globalsSha: 'pg/2026-09-26/globals.sql.sha256', inventory: 'docs-inventory/2026-09-26.json', manifest: 'manifests/2026-09-26.json',
});
eq('classifyKey pg', lib.classifyKey('pg/2026-09-26/radar.dump'), { kind: 'pg', date: '2026-09-26' });
eq('classifyKey inventory', lib.classifyKey('docs-inventory/2026-09-26.json'), { kind: 'inventory', date: '2026-09-26' });
eq('classifyKey manifest', lib.classifyKey('manifests/2026-09-26.json'), { kind: 'manifest', date: '2026-09-26' });
ok('classifyKey never matches docs/, latest, nested or invalid dates', ['docs/pg/2026-09-26/x', 'manifests/latest.json',
  'pg/2026-09-26/sub/x', 'pg/2026-13-01/radar.dump', 'pg/notes.txt', 'docs-inventory/2026-09-26.json.bak'].every((k) => lib.classifyKey(k) === null));

console.log('# retention — 500-day daily simulation (purge every day)');
{
  const existing = new Set();
  let invariantsOk = true; let maxSize = 0;
  const start = '2025-01-01';
  let today = start;
  for (let i = 0; i < 500; i += 1) {
    today = addDays(start, i);
    existing.add(today);
    const plan = lib.planRetention({ today, dates: [...existing], completeDates: [...existing] });
    for (const d of plan.purge) existing.delete(d);
    for (let a = 0; a < Math.min(7, i + 1); a += 1) if (!existing.has(addDays(today, -a))) invariantsOk = false;
    maxSize = Math.max(maxSize, existing.size);
  }
  ok('the last 7 days are always present', invariantsOk);
  // 4 weekly points = the Sunday inside the daily window + exactly 3 older Sundays (ages 7..27).
  ok(`history bounded (max ${maxSize} <= 16 = 7 daily + 3 older Sundays + 6 monthly)`, maxSize <= 16);
  const t = lib.dayNumber(today);
  const expected = range(start, today).filter((d) => {
    const age = t - lib.dayNumber(d);
    return age < 7 || (lib.weekdayUtc(d) === 0 && age < 28) || (d.endsWith('-01') && lib.monthIndex(today) - lib.monthIndex(d) < 6);
  });
  eq(`final set on ${today} = last 7 days + Sundays < 28 d + 1st of the last 6 months`, [...existing].sort(), expected);
}
{
  // Sunday 2026-09-13 missing → the Saturday becomes the weekly point of that week.
  const existing = new Set();
  for (const today of range('2026-08-01', '2026-09-30')) {
    if (today === '2026-09-13') continue; // no run that day (no backup, no purge)
    existing.add(today);
    const plan = lib.planRetention({ today, dates: [...existing], completeDates: [...existing] });
    for (const d of plan.purge) existing.delete(d);
  }
  ok('missing Sunday → Saturday 2026-09-12 kept as weekly', existing.has('2026-09-12'));
  ok('…and the other days of that week purged', !existing.has('2026-09-11') && !existing.has('2026-09-10'));
}
{
  const all = range('2026-08-02', '2026-09-27'); // today = Sunday 2026-09-27
  const plan = lib.planRetention({ today: '2026-09-27', dates: all, completeDates: all });
  ok('weekly boundary: Sunday aged 21 kept, Sunday aged exactly 28 purged', plan.keep.includes('2026-09-06') && plan.purge.includes('2026-08-30'));
  ok('daily boundary: aged 6 kept, aged 7 (a Sunday) kept only as weekly', plan.reasons['2026-09-21'].includes('daily') &&
    JSON.stringify(plan.reasons['2026-09-20']) === JSON.stringify(['weekly']));
  ok('monthly boundary: 1st of the month 6 months back purged', lib.planRetention({ today: '2026-10-01', dates: ['2026-04-01', '2026-05-01', '2026-10-01'],
    completeDates: ['2026-04-01', '2026-05-01', '2026-10-01'], minKeep: 1 }).purge.join() === '2026-04-01');
}
{
  const complete = [...range('2026-09-01', '2026-09-10'), '2026-09-25'];
  const plan = lib.planRetention({ today: '2026-09-25', dates: complete, completeDates: complete });
  eq('outage: min-keep holds the 7 newest backups', plan.keep, ['2026-09-01', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-25']);
  eq('outage: purge set', plan.purge, ['2026-09-02', '2026-09-03', '2026-09-04']);
}
{
  const all = range('2026-09-01', '2026-09-26');
  const complete = all.filter((d) => d !== '2026-09-03' && d !== '2026-09-24');
  const plan = lib.planRetention({ today: '2026-09-26', dates: [...all, '2026-09-28'], completeDates: complete });
  ok('unfinished day inside the daily window kept', plan.keep.includes('2026-09-24'));
  ok('unfinished day outside the daily window purged', plan.purge.includes('2026-09-03'));
  ok('future date never purged', plan.keep.includes('2026-09-28') && plan.reasons['2026-09-28'].includes('future'));
  ok('monthly point = 1st', plan.reasons['2026-09-01'].includes('monthly'));
}

console.log('# parsers / guards');
eq('parseEnvFile keeps spaces in values', lib.parseEnvFile('DATE=2026-09-26\nSERVER_VERSION=16.4 (Debian)\nbad line\n'), { DATE: '2026-09-26', SERVER_VERSION: '16.4 (Debian)' });
eq('parseSha256Line', lib.parseSha256Line(`${'f'.repeat(64)}  radar.dump\n`), { sha256: 'f'.repeat(64), name: 'radar.dump' });
eq('parseSha256Line rejects garbage', lib.parseSha256Line('nope'), null);
eq('parseMigrationsCopy: count + last by id (not by created_at)', lib.parseMigrationsCopy(MIGRATIONS_SQL), {
  migrationsApplied: 3, lastMigration: { id: 3, hash: 'c'.repeat(64), createdAt: '1749524400000' },
});
eq('parseMigrationsCopy: absent table → null', lib.parseMigrationsCopy('-- empty\n'), null);
eq('resolveMigrationTag via journal `when`', lib.resolveMigrationTag('1749524400000', JOURNAL), '0002_graph_store');
eq('resolveMigrationTag unknown → null', lib.resolveMigrationTag('1', JOURNAL), null);
eq('withScheme bare host', lib.withScheme('s3.bhs.io.cloud.ovh.net'), 'https://s3.bhs.io.cloud.ovh.net');
eq('withScheme keeps scheme', lib.withScheme('http://minio:9000'), 'http://minio:9000');
eq('parsePrefixes', lib.parsePrefixes(' archive/ ,, big/ '), ['archive/', 'big/']);
eq('checkDumpSize ok', lib.checkDumpSize({ size: 5000, previousSize: 6000, minBytes: 1000, minRatio: 0.5 }).ok, true);
eq('checkDumpSize floor', lib.checkDumpSize({ size: 999, previousSize: 0, minBytes: 1000, minRatio: 0.5 }).ok, false);
eq('checkDumpSize relative drop', lib.checkDumpSize({ size: 2999, previousSize: 6000, minBytes: 1000, minRatio: 0.5 }).ok, false);
eq('checkDumpSize ratio 0 disables relative check', lib.checkDumpSize({ size: 1000, previousSize: 1e9, minBytes: 1000, minRatio: 0 }).ok, true);
{
  const t0 = new Date('2026-09-01T00:00:00Z'); const t1 = new Date('2026-09-02T00:00:00Z');
  ok('upToDate: same size + same ETag', lib.upToDate({ Size: 5, ETag: '"a"', LastModified: t1 }, { Size: 5, ETag: '"a"', LastModified: t0 }));
  ok('upToDate: multipart ETag differs but copy is newer', lib.upToDate({ Size: 5, ETag: '"a-2"', LastModified: t0 }, { Size: 5, ETag: '"b"', LastModified: t1 }));
  ok('not upToDate: rewritten same size after the copy', !lib.upToDate({ Size: 5, ETag: '"c"', LastModified: t1 }, { Size: 5, ETag: '"a"', LastModified: t0 }));
  ok('not upToDate: size differs', !lib.upToDate({ Size: 6, ETag: '"a"', LastModified: t0 }, { Size: 5, ETag: '"a"', LastModified: t1 }));
  ok('not upToDate: absent', !lib.upToDate({ Size: 6, ETag: '"a"' }, undefined));
  ok('not upToDate: ETag differs and LastModified tie (strict >)', !lib.upToDate({ Size: 5, ETag: '"a-2"', LastModified: t1 }, { Size: 5, ETag: '"b"', LastModified: t1 }));
}
eq('checkDocsSource ok', lib.checkDocsSource({ count: 7, previousCount: 7, minRatio: 0.5 }).ok, true);
eq('checkDocsSource: empty source refused', lib.checkDocsSource({ count: 0, previousCount: 0, minRatio: 0.5 }).ok, false);
eq('checkDocsSource: collapsed source refused (< 0.5 x previous)', lib.checkDocsSource({ count: 49, previousCount: 100, minRatio: 0.5 }).ok, false);
eq('checkDocsSource: first run (no previous) accepted', lib.checkDocsSource({ count: 3, previousCount: null, minRatio: 0.5 }).ok, true);
eq('docsStatus', [lib.docsStatus({ pending: 0, failed: 0 }), lib.docsStatus({ pending: 2, failed: 0 }), lib.docsStatus({ pending: 2, failed: 1 }), lib.docsStatus(null, new Error('x'))],
  ['complete', 'partial', 'incomplete', 'incomplete']);
{
  const L = (o) => ({ date: '2026-09-26', status: 'complete', latestComplete: { date: '2026-09-26' }, firstBackupDate: '2026-09-01', ...o });
  eq('checkFreshness: today → ok', lib.checkFreshness({ today: '2026-09-26', latest: L() }).ok, true);
  eq('checkFreshness: yesterday → ok (J-1 allowed)', lib.checkFreshness({ today: '2026-09-27', latest: L() }).ok, true);
  eq('checkFreshness: 2 days old → stale', lib.checkFreshness({ today: '2026-09-28', latest: L() }).ok, false);
  eq('checkFreshness: partial for 3 days → ok, 4 days → fail', [
    lib.checkFreshness({ today: '2026-09-29', latest: L({ date: '2026-09-29', status: 'partial' }) }).ok,
    lib.checkFreshness({ today: '2026-09-30', latest: L({ date: '2026-09-30', status: 'partial' }) }).ok], [true, false]);
  eq('checkFreshness: N configurable (maxIncompleteDays=1)', lib.checkFreshness({ today: '2026-09-28', latest: L({ date: '2026-09-28', status: 'partial' }), maxIncompleteDays: 1 }).ok, false);
  eq('checkFreshness: seed in progress since the first backup (no complete yet)', [
    lib.checkFreshness({ today: '2026-09-27', latest: L({ date: '2026-09-27', status: 'partial', latestComplete: null, firstBackupDate: '2026-09-26' }) }).ok,
    lib.checkFreshness({ today: '2026-09-30', latest: L({ date: '2026-09-30', status: 'partial', latestComplete: null, firstBackupDate: '2026-09-26' }) }).ok], [true, false]);
  eq('checkFreshness: no pointer → fail', lib.checkFreshness({ today: '2026-09-26', latest: null }).ok, false);
}
{
  const P = (o) => ({ format: lib.PLAN_FORMAT, date: '2026-09-26', backupStatus: 'complete', keys: ['pg/2026-09-01/radar.dump'], ...o });
  eq('validatePurgePlan: complete plan runs', lib.validatePurgePlan(P(), { today: '2026-09-26', dailyDays: 7 }).run, true);
  eq('validatePurgePlan: partial backup → purge does not run', lib.validatePurgePlan(P({ backupStatus: 'partial' }), { today: '2026-09-26', dailyDays: 7 }), { run: false, keys: [] });
  throwsCode('validatePurgePlan: no plan → exit 3', () => lib.validatePurgePlan(null, { today: '2026-09-26', dailyDays: 7 }), 3);
  throwsCode('validatePurgePlan: non-dated key (docs/) → exit 3', () => lib.validatePurgePlan(P({ keys: ['docs/raw/x.pdf'] }), { today: '2026-09-26', dailyDays: 7 }), 3);
  throwsCode('validatePurgePlan: latest.json → exit 3', () => lib.validatePurgePlan(P({ keys: ['manifests/latest.json'] }), { today: '2026-09-26', dailyDays: 7 }), 3);
  throwsCode('validatePurgePlan: key inside the daily window → exit 3', () => lib.validatePurgePlan(P({ keys: ['pg/2026-09-21/radar.dump'] }), { today: '2026-09-26', dailyDays: 7 }), 3);
  throwsCode('validatePurgePlan: stale plan (other run) → exit 3', () => lib.validatePurgePlan(P(), { today: '2026-10-02', dailyDays: 7 }), 3);
}
eq('readConfig purge mode needs no SOURCE_DOCS_BUCKET', lib.readConfig(purgerEnv('/w'), 'purge').mode, 'purge');
throwsCode('readConfig backup mode requires SOURCE_DOCS_BUCKET', () => lib.readConfig({ ...envFor('/w'), SOURCE_DOCS_BUCKET: '' }, 'backup'), 2);
throwsCode('readConfig: MIN_DOCS_RATIO >= 1 → exit 2', () => lib.readConfig({ ...envFor('/w'), MIN_DOCS_RATIO: '1' }), 2);
throwsCode('readConfig: missing secret key → exit 2', () => lib.readConfig({ ...envFor('/w'), S3_SECRET_KEY: '' }), 2);
throwsCode('readConfig: invalid number → exit 2', () => lib.readConfig({ ...envFor('/w'), COPY_CONCURRENCY: 'many' }), 2);
throwsCode('readConfig: MIN_DUMP_RATIO >= 1 → exit 2', () => lib.readConfig({ ...envFor('/w'), MIN_DUMP_RATIO: '1' }), 2);
throwsCode('readConfig: part size < 5 MiB → exit 2', () => lib.readConfig({ ...envFor('/w'), MULTIPART_PART_BYTES: '1024' }), 2);
throwsCode('assertBuckets: backup == source → exit 2', () => lib.assertBuckets(lib.readConfig({ ...envFor('/w'), BACKUP_BUCKET: DOCS, EXPECTED_BACKUP_BUCKET: '' })), 2);
throwsCode('assertBuckets: unexpected backup bucket → exit 2', () => lib.assertBuckets(lib.readConfig({ ...envFor('/w'), BACKUP_BUCKET: 'other' })), 2);
throwsCode('assertBuckets: unexpected source bucket → exit 2', () => lib.assertBuckets(lib.readConfig({ ...envFor('/w'), SOURCE_DOCS_BUCKET: 'other' })), 2);

// ═════════════════════════════════════════════════════════════════════════════
console.log('# runBackup — first run with 210 days of un-purged history');
{
  const { clock, fake } = mkWorld();
  const partial = new Set(['2026-08-15', '2026-09-24']);
  for (const d of range('2026-03-01', '2026-09-25')) {
    fake.seed(BK, `pg/${d}/radar.dump`, 'old-dump');
    fake.seed(BK, `pg/${d}/radar.dump.sha256`, 'old-sha');
    fake.seed(BK, `docs-inventory/${d}.json`, '{}');
    if (!partial.has(d)) fake.seed(BK, `manifests/${d}.json`, '{}');
  }
  fake.seed(BK, 'manifests/latest.json', JSON.stringify({ date: '2026-09-25', pgSizeBytes: 400 * 1024, docsObjects: 7, firstBackupDate: '2026-03-01' }));
  fake.seed(BK, 'pg/notes.txt', 'operator note');
  const { dir, dump } = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(dir));
  eq('exit 0', res.code, 0);
  eq('backup step (writer) issued ZERO delete', deletes(fake).length, 0);
  ok('backup step left a purge plan for a complete backup', readPlan(dir).backupStatus === 'complete' && readPlan(dir).keys.length > 0);
  const pres = await runPurge(fake, clock, dir);
  eq('purge step (purger: DeleteObject only, no List/Get) exit 0', pres.code, 0);
  ok('purge step issued only DeleteObject calls', fake.calls.slice(fake.calls.findIndex((c) => c.op === 'DeleteObject')).every((c) => c.op === 'DeleteObject'));
  const m = res.r && res.r.manifest;
  const stored = JSON.parse(fake.text(BK, 'manifests/2026-09-26.json') || '{}');
  eq('manifest stored = manifest returned', stored, m);
  eq('manifest status', m.status, 'complete');
  eq('dump uploaded byte-exact', fake.latest(fake.b(BK), 'pg/2026-09-26/radar.dump').body.equals(dump), true);
  eq('sha256 object', fake.text(BK, 'pg/2026-09-26/radar.dump.sha256'), `${sha(dump)}  radar.dump\n`);
  eq('manifest pg', [m.pg.key, m.pg.sha256, m.pg.sizeBytes, m.pg.multipart, m.pg.serverVersion, m.pg.postgisVersion, m.pg.tocEntries],
    ['pg/2026-09-26/radar.dump', sha(dump), dump.length, false, '16.4 (Debian 16.4-1.pgdg120+2)', '3.4.3', 812]);
  ok('dump re-read after upload (HEAD + GET on the dump key)', fake.calls.some((c) => c.op === 'HeadObject' && c.input.Key === 'pg/2026-09-26/radar.dump') &&
    fake.calls.filter((c) => c.op === 'GetObject' && c.input.Key === 'pg/2026-09-26/radar.dump').length === 1);
  eq('globals uploaded', [m.pg.globals.status, m.pg.globals.key, m.pg.globals.rolePasswords], ['ok', 'pg/2026-09-26/globals.sql', 'excluded']);
  eq('schema from dump + journal tag', m.schema, { status: 'ok', source: 'dump: drizzle.__drizzle_migrations', migrationsApplied: 3,
    lastMigration: { id: 3, hash: 'c'.repeat(64), createdAt: '1749524400000', tag: '0002_graph_store' } });
  eq('served code sha', m.code.servedSha, 'abc1234');
  eq('docs counts', [m.docs.status, m.docs.objects, m.docs.copied, m.docs.alreadyUpToDate, m.docs.pending, m.docs.versionIds],
    ['complete', 7, 6, 1, 0, 'list-versions']);
  ok('docs mirrored under docs/ (all 7 source keys)', DOC_KEYS.every((k) => fake.text(BK, `docs/${k}`) === fake.text(DOCS, k)));
  const inv = JSON.parse(fake.text(BK, 'docs-inventory/2026-09-26.json'));
  eq('inventory sha256 in manifest', m.docs.inventorySha256, sha(Buffer.from(fake.text(BK, 'docs-inventory/2026-09-26.json'))));
  ok('inventory: every object backed-up with a versionId and backup ETag', inv.objects.length === 7 && inv.objects.every((o) => o.state === 'backed-up' && o.versionId && o.backupEtag));
  ok('inventory sorted by key', inv.objects.map((o) => o.key).join('|') === [...DOC_KEYS].sort().join('|'));
  const latest = JSON.parse(fake.text(BK, 'manifests/latest.json'));
  eq('latest pointer', [latest.date, latest.manifestKey, latest.pgSizeBytes, latest.status, latest.docsObjects], ['2026-09-26', 'manifests/2026-09-26.json', dump.length, 'complete', 7]);
  eq('latest pointer: latestComplete = today, firstBackupDate carried over', [latest.latestComplete, latest.firstBackupDate],
    [{ date: '2026-09-26', manifestKey: 'manifests/2026-09-26.json' }, '2026-03-01']);
  eq('manifest checks record the previous size', m.pg.checks.previousSizeBytes, 400 * 1024);
  // retention: 1st of Apr..Sep (monthly), Sundays Aug 30 / Sep 6 / Sep 13 (weekly), Sep 20..26 (daily),
  // Sep 19 (min-keep: Sep 24 is unfinished, so the 7 newest complete backups reach back to Sep 19).
  const keptExpected = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-08-30', '2026-09-01',
    '2026-09-06', '2026-09-13', '2026-09-19', ...range('2026-09-20', '2026-09-26')];
  const datesLeft = [...new Set(fake.current(BK).map((o) => lib.classifyKey(o.Key)).filter(Boolean).map((c) => c.date))].sort();
  eq('retention: dated folders left', datesLeft, keptExpected);
  ok('retention: purge used delete-markers only (no VersionId)', deletes(fake).every((c) => !c.input.VersionId));
  ok('retention: never touched docs/ nor latest nor unknown keys', deletes(fake).every((c) => lib.classifyKey(c.input.Key)) &&
    fake.text(BK, 'pg/notes.txt') === 'operator note' && fake.text(BK, 'manifests/latest.json'));
  ok('retention: purged versions are still there as noncurrent (lock/lifecycle expire them)', fake.b(BK).keys.get('pg/2026-03-02/radar.dump').length === 2);
  eq('retention: plan result', [readPlan(dir).keptDates, readPlan(dir).purgedDates.length, pres.r.deleteMarkers], [17, 210 - 17, readPlan(dir).keys.length]);
  noLeak('first run', res.logs.concat(pres.logs), JSON.stringify(m));
  ok('verdict line', res.logs.some((l) => l.startsWith('VERDICT OK date=2026-09-26 status=complete')) && pres.logs.some((l) => l.startsWith('PURGE OK')));
  const f1 = await runFresh(fake, clock);
  eq('freshness (reader: Get/Head only) right after the backup → exit 0', f1.code, 0);

  console.log('# runBackup — next day is incremental and idempotent');
  clock.t += 86400000;
  const w2 = makeWork('2026-09-27', { bytes: 310 * 1024 });
  const res2 = await run(fake, clock, envFor(w2.dir));
  eq('day 2 exit 0', res2.code, 0);
  eq('day 2 docs: nothing to copy', [res2.r.manifest.docs.copied, res2.r.manifest.docs.alreadyUpToDate], [0, 7]);
  const plan2 = readPlan(w2.dir);
  ok('day 2 plan kept the Sunday + 6 previous days', plan2.purgedDates.every((d) => d < '2026-09-20') && !plan2.purgedDates.includes('2026-09-20'));
  eq('day 2 purge exit 0', (await runPurge(fake, clock, w2.dir)).code, 0);
  noLeak('day 2', res2.logs);

  console.log('# freshness — stale / tampered');
  clock.t += 2 * 86400000; // 2026-09-29, no backup since 09-27
  const f2 = await runFresh(fake, clock);
  eq('no backup for 2 days → freshness exit 5', f2.code, 5);
  ok('…reason logged, verdict only', f2.logs.some((l) => l.startsWith('FRESHNESS FAIL') && l.includes('days old')));
  clock.t -= 2 * 86400000;
  fake.seed(BK, 'manifests/2026-09-27.json', '{"tampered":true}');
  eq('manifest bytes differ from the pointer → freshness exit 5', (await runFresh(fake, clock)).code, 5);
}
{
  const { clock, fake } = mkWorld();
  eq('no latest.json at all → freshness exit 5', (await runFresh(fake, clock)).code, 5);
}

console.log('# runBackup — multipart above the threshold');
{
  const { clock, fake } = mkWorld();
  const { dir, dump } = makeWork('2026-09-26', { bytes: 300 * 1024 });
  const res = await run(fake, clock, envFor(dir), { overrides: { multipartThreshold: 100 * 1024, partSize: 64 * 1024 } });
  eq('exit 0', res.code, 0);
  eq('5 parts uploaded with Content-MD5', fake.calls.filter((c) => c.op === 'UploadPart').length, 5);
  eq('multipart object byte-exact', fake.latest(fake.b(BK), 'pg/2026-09-26/radar.dump').body.equals(dump), true);
  eq('manifest multipart flag', res.r.manifest.pg.multipart, true);
}

console.log('# runBackup — refusals and degraded paths');
{
  const { clock, fake } = mkWorld();
  const { dir } = makeWork('2026-09-26', { bytes: 50 * 1024 });
  fake.seed(BK, 'manifests/latest.json', JSON.stringify({ pgSizeBytes: 500 * 1024 }));
  const res = await run(fake, clock, envFor(dir));
  eq('dump < 0.5 x previous → exit 2', res.code, 2);
  ok('…and nothing written under pg/ nor manifests/<date>', !fake.calls.some((c) => c.op === 'PutObject' || c.op === 'CreateMultipartUpload'));
}
{
  const { clock, fake } = mkWorld();
  const { dir, dump } = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(dir, { MIN_DUMP_BYTES: String(dump.length + 1) }));
  eq('dump < MIN_DUMP_BYTES → exit 2', res.code, 2);
}
{
  const { clock, fake } = mkWorld();
  fake.b(BK).versioning = 'Suspended';
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('versioning Suspended → exit 2', res.code, 2);
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.GetBucketVersioning = () => s3err('AccessDenied', 403);
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('GetBucketVersioning denied → proceeds', res.code, 0);
  ok('…recorded as unverified', res.r.manifest.tool.bucketVersioning.startsWith('unverified'));
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.ListObjectVersions = () => s3err('AccessDenied', 403);
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('ListObjectVersions denied → fallback, exit 0', res.code, 0);
  const inv = JSON.parse(fake.text(BK, 'docs-inventory/2026-09-26.json'));
  eq('…versionIds = copy-only', res.r.manifest.docs.versionIds, 'copy-only');
  ok('…copied objects carry a versionId, the up-to-date one does not', inv.objects.filter((o) => o.versionId).length === 6 &&
    inv.objects.find((o) => o.key === 'raw/ville-c/a.pdf').versionId === null && inv.objects.every((o) => o.backupEtag));
}
{
  const { clock, fake } = mkWorld();
  for (const d of range('2026-01-01', '2026-01-10')) fake.seed(BK, `manifests/${d}.json`, '{}');
  fake.seed(BK, 'manifests/latest.json', JSON.stringify({ date: '2026-09-25', status: 'complete', pgSizeBytes: 1000, docsObjects: 7,
    latestComplete: { date: '2026-09-25', manifestKey: 'manifests/2026-09-25.json' }, firstBackupDate: '2026-09-01' }));
  fake.hooks.CopyObject = () => { clock.t += 5401 * 1000; }; // the first copy exhausts the budget
  const w = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(w.dir, { COPY_CONCURRENCY: '1' }));
  eq('docs seed still pending (budget) → status partial, exit 0 (NOT a failed Job)', [res.code, res.r && res.r.manifest.status], [0, 'partial']);
  eq('…1 copied, 5 pending, budget flag', [res.r.manifest.docs.copied, res.r.manifest.docs.pending, res.r.manifest.docs.budgetExhausted], [1, 5, true]);
  ok('…PG backup recorded, verdict PARTIAL explicit', !!fake.text(BK, 'pg/2026-09-26/radar.dump.sha256') && res.logs.some((l) => l.startsWith('VERDICT PARTIAL')));
  const latest = JSON.parse(fake.text(BK, 'manifests/latest.json'));
  eq('…latest.status partial, latestComplete still the previous complete day', [latest.status, latest.latestComplete.date], ['partial', '2026-09-25']);
  eq('…plan marks the backup partial with no key', [readPlan(w.dir).backupStatus, readPlan(w.dir).keys.length], ['partial', 0]);
  const p = await runPurge(fake, clock, w.dir);
  eq('purge after a partial backup: skipped, exit 0, zero delete', [p.code, p.r.skipped, deletes(fake).length], [0, true, 0]);
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.CopyObject = (input) => (input.Key.endsWith('x.pdf') ? s3err('InternalError', 500) : undefined);
  const w = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(w.dir));
  eq('one copy fails → status incomplete, exit 4 (real error), inventory state=failed',
    [res.code, res.r.manifest.status, JSON.parse(fake.text(BK, 'docs-inventory/2026-09-26.json')).counts.failed], [4, 'incomplete', 1]);
  eq('…plan: no purge after an incomplete backup', readPlan(w.dir).keys.length, 0);
  noLeak('copy failure', res.logs);
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.ListObjectsV2 = (input) => (input.Bucket === DOCS ? s3err('AccessDenied', 403) : undefined);
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('docs source unreadable → exit 4, incomplete, PG recorded', [res.code, res.r.manifest.docs.status, !!res.r.manifest.pg.sha256], [4, 'incomplete', true]);
}
{
  const { clock, fake } = mkWorld();
  for (const k of DOC_KEYS) fake.b(DOCS).keys.delete(k);
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('docs source EMPTY → refused, exit 2', res.code, 2);
  ok('…nothing written (no PG upload, no manifest, no plan)', !fake.calls.some((c) => c.op === 'PutObject' || c.op === 'CreateMultipartUpload'));
}
{
  const { clock, fake } = mkWorld();
  fake.seed(BK, 'manifests/latest.json', JSON.stringify({ date: '2026-09-25', pgSizeBytes: 1000, docsObjects: 20 }));
  const w = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(w.dir));
  eq('docs source collapsed (7 < 0.5 x 20) → refused, exit 2', res.code, 2);
  ok('…nothing written and no purge plan', !fake.calls.some((c) => c.op === 'PutObject') && !fs.existsSync(path.join(w.dir, lib.PLAN_FILE)));
  const p = await runPurge(fake, clock, w.dir);
  eq('…purge step without plan refuses (exit 3), zero delete', [p.code, deletes(fake).length], [3, 0]);
}
{
  const { clock, fake } = mkWorld();
  const w = makeWork('2026-09-26');
  fs.writeFileSync(path.join(w.dir, lib.PLAN_FILE), JSON.stringify({ format: lib.PLAN_FORMAT, date: '2026-09-26', backupStatus: 'complete',
    keptDates: 1, purgedDates: ['2026-09-01'], keys: ['pg/2026-09-01/radar.dump', 'docs/raw/ville-c/a.pdf'] }));
  const p = await runPurge(fake, clock, w.dir);
  eq('tampered plan (a docs/ key) → purge refused, exit 3, zero delete', [p.code, deletes(fake).length], [3, 0]);
}
{
  const { clock, fake } = mkWorld();
  let once = true;
  fake.hooks.GetObject = (input) => {
    if (input.Key.endsWith('radar.dump') && once) { once = false; return { Body: Readable.from([Buffer.from('corrupted')]) }; }
    return undefined;
  };
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('re-read sha256 mismatch → exit 1 (retryable)', res.code, 1);
  ok('…no manifest written', fake.text(BK, 'manifests/2026-09-26.json') === null);
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.DeleteObject = () => s3err('InternalError', 500);
  for (const d of range('2026-01-01', '2026-01-10')) fake.seed(BK, `manifests/${d}.json`, '{}');
  const w = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(w.dir));
  eq('backup complete (exit 0) …', res.code, 0);
  eq('…then a purge failure → purge step exit 3', (await runPurge(fake, clock, w.dir)).code, 3);
  ok('…manifest of the day is complete', JSON.parse(fake.text(BK, 'manifests/2026-09-26.json')).status === 'complete');
}
{
  const { clock, fake } = mkWorld();
  for (const d of range('2026-01-01', '2026-01-10')) fake.seed(BK, `manifests/${d}.json`, '{}');
  // the listing of manifests/ does not show today's manifest → the plan is refused
  fake.hooks.ListObjectsV2 = (input) => (input.Bucket === BK && input.Prefix === 'manifests/' ? { Contents: [], IsTruncated: false } : undefined);
  const w = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(w.dir));
  eq('purge plan refused when the manifest of today is not listed (exit 3)', res.code, 3);
  ok('…no plan written, nothing deleted', !fs.existsSync(path.join(w.dir, lib.PLAN_FILE)) && deletes(fake).length === 0);
}
{
  const { clock, fake } = mkWorld();
  const res = await run(fake, clock, envFor(makeWork('2026-09-26', { globals: false, migrations: false }).dir));
  eq('globals failed + no migrations → still exit 0', res.code, 0);
  eq('…recorded', [res.r.manifest.pg.globals.status, res.r.manifest.schema.status], ['failed', 'unknown']);
}
{
  const { clock, fake } = mkWorld();
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir, { DOCS_EXCLUDE_PREFIXES: 'archive/' }));
  const inv = JSON.parse(fake.text(BK, 'docs-inventory/2026-09-26.json'));
  eq('excluded prefix: not copied, state=excluded, docs complete', [res.code, res.r.manifest.docs.excluded, fake.text(BK, 'docs/archive/2019/big.pdf'),
    inv.objects.find((o) => o.key === 'archive/2019/big.pdf').state], [0, 1, null, 'excluded']);
}
{
  const { clock, fake } = mkWorld();
  fake.seed(BK, 'manifests/latest.json', '{not json');
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir), { fetchImpl: async () => { throw new Error('offline'); } });
  eq('corrupt latest pointer + /health unreachable → exit 0', res.code, 0);
  eq('…code sha unknown', res.r.manifest.code.servedSha, 'unknown');
}
{
  const { clock, fake } = mkWorld();
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir, { BACKUP_BUCKET: DOCS }));
  eq('secret pointing the backup at the docs bucket → exit 2', res.code, 2);
  ok('…zero S3 call', fake.calls.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('# static wiring checks');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
{
  const cj = read('deploy/ci/backup/cronjob-backup-daily.yaml');
  const prodDump = read('deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml');
  const pinned = /image:\s*"(ghcr\.io\/rhanka\/radar-api@sha256:[0-9a-f]{64})"/.exec(prodDump)[1];
  ok('CronJob name/ns/schedule/Forbid', /name: radar-backup-daily\n/.test(cj) && /namespace: radar-immobilier\n/.test(cj) &&
    /schedule: "23 2 \* \* \*"/.test(cj) && /concurrencyPolicy: Forbid/.test(cj));
  ok('same radar-api digest as the prod bundle (no new image)', cj.includes(`image: "${pinned}"`) && cj.includes(`name: BACKUP_IMAGE, value: "${pinned}"`));
  ok('dump image = postgis/postgis:16-3.4', /image: postgis\/postgis:16-3\.4\n/.test(cj));
  ok('pod label component=db-backup (netpol allow-backup-to-postgres)', (cj.match(/app\.kubernetes\.io\/component: db-backup/g) || []).length >= 2);
  // Step order: initContainers dump → backup, then the only main container purge
  // (a main container starts only after every initContainer exited 0).
  const iInit = cj.indexOf('\n          initContainers:'); const iDump = cj.indexOf('- name: dump');
  const iBackup = cj.indexOf('- name: backup'); const iMain = cj.indexOf('\n          containers:'); const iPurge = cj.indexOf('- name: purge');
  ok('steps: initContainers [dump, backup] then containers [purge]', iInit > 0 && iInit < iDump && iDump < iBackup && iBackup < iMain && iMain < iPurge &&
    (cj.slice(iMain).match(/\n {12}- name: /g) || []).length === 1);
  const initPart = cj.slice(iInit, iMain); const purgePart = cj.slice(iMain);
  ok('backup step mounts the writer only (no purger, no reader)', /name: radar-backup-writer, key: S3_SECRET_KEY/.test(initPart) &&
    !initPart.includes('radar-backup-purger') && !initPart.includes('radar-backup-reader'));
  ok('purge step mounts the purger only (no writer, no reader)', /name: radar-backup-purger, key: S3_SECRET_KEY/.test(purgePart) &&
    !purgePart.includes('radar-backup-writer') && !purgePart.includes('radar-backup-reader'));
  ok('purge step reads the work volume read-only', /name: work, mountPath: \/work, readOnly: true/.test(purgePart));
  ok('commands: backup / purge modes', cj.includes('["node", "/opt/backup/backup-daily.cjs", "backup"]') && cj.includes('["node", "/opt/backup/backup-daily.cjs", "purge"]'));
  ok('DB via the RO role secret', /name: radar-db-ro-prod, key: POSTGRES_PASSWORD/.test(cj) && !cj.includes('radar-db-credentials'));
  ok('podFailurePolicy FailJob on 2/3/4', /values: \[2, 3, 4\]/.test(cj));
  ok('manual-run guard: non-CronJob Job refused in the scheduled window', cj.includes("fieldPath: \"metadata.labels['job-name']\"") &&
    cj.includes('radar-backup-daily-[0-9]*)') && /SCHEDULED_WINDOW_START, value: "0200"/.test(cj) && /SCHEDULED_WINDOW_END, value: "0530"/.test(cj));
  const active = (t) => t.split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n');
  ok('no python in any active line of the backup bundle', !/python|\.py\b/i.test(active(cj) + active(read('deploy/ci/backup/backup-daily.cjs'))));
  const cfgKeys = ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'BACKUP_BUCKET', 'SOURCE_DOCS_BUCKET', 'EXPECTED_BACKUP_BUCKET',
    'EXPECTED_SOURCE_DOCS_BUCKET', 'WORK_DIR', 'PUBLIC_HEALTH_URL', 'DRIZZLE_JOURNAL', 'COPY_CONCURRENCY', 'DOCS_COPY_BUDGET_SECONDS',
    'MIN_DUMP_BYTES', 'MIN_DUMP_RATIO', 'MIN_DOCS_RATIO', 'RETENTION_DAILY_DAYS', 'RETENTION_WEEKLY_WEEKS', 'RETENTION_MONTHLY_MONTHS', 'RETENTION_MIN_KEEP'];
  ok('every runtime knob is set explicitly in the CronJob', cfgKeys.every((k) => cj.includes(`name: ${k},`)));
  const fj = read('deploy/ci/backup/cronjob-backup-freshness.yaml');
  ok('freshness CronJob: name/schedule/Forbid, reader identity only, same image', /name: radar-backup-freshness\n/.test(fj) && /schedule: "53 6 \* \* \*"/.test(fj) &&
    /concurrencyPolicy: Forbid/.test(fj) && /name: radar-backup-reader, key: S3_SECRET_KEY/.test(fj) && !fj.includes('radar-backup-writer') &&
    !fj.includes('radar-backup-purger') && fj.includes(`image: "${pinned}"`) && fj.includes('["node", "/opt/backup/backup-daily.cjs", "freshness"]'));
  ok('freshness knobs explicit (J-1, N=3)', /FRESHNESS_MAX_AGE_DAYS, value: "1"/.test(fj) && /FRESHNESS_MAX_INCOMPLETE_DAYS, value: "3"/.test(fj));
  const cfg = lib.readConfig(Object.fromEntries([...cj.matchAll(/\{ name: ([A-Z_0-9]+), value: "([^"]*)" \}/g)].map((x) => [x[1], x[2]])
    .concat([['S3_ENDPOINT', 'e'], ['S3_REGION', 'r'], ['S3_ACCESS_KEY', 'a'], ['S3_SECRET_KEY', 's'], ['BACKUP_BUCKET', BK], ['SOURCE_DOCS_BUCKET', DOCS]])));
  eq('CronJob values parse into the documented retention', cfg.retention, { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 6, minKeep: 7 });
}
{
  const w = read('deploy/ci/backup/radar-backup-writer-sealed.yaml');
  const r = read('deploy/ci/backup/radar-backup-reader-sealed.yaml');
  const keys = (t) => [...t.matchAll(/^ {4}([A-Z_0-9]+): Ag/mg)].map((x) => x[1]).sort();
  ok('writer SealedSecret name/ns', /kind: SealedSecret/.test(w) && /name: radar-backup-writer\n\s+namespace: radar-immobilier/.test(w));
  eq('writer keys', keys(w), ['BACKUP_BUCKET', 'S3_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION', 'S3_SECRET_KEY', 'SOURCE_DOCS_BUCKET']);
  ok('reader SealedSecret name/ns', /kind: SealedSecret/.test(r) && /name: radar-backup-reader\n\s+namespace: radar-immobilier/.test(r));
  eq('reader keys', keys(r), ['BACKUP_BUCKET', 'S3_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION', 'S3_SECRET_KEY']);
  const p = read('deploy/ci/backup/radar-backup-purger-sealed.yaml');
  ok('purger SealedSecret name/ns', /^kind: SealedSecret/m.test(p) && /name: radar-backup-purger\n\s+namespace: radar-immobilier/.test(p));
  eq('purger keys', keys(p), ['BACKUP_BUCKET', 'S3_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION', 'S3_SECRET_KEY']);
}
{
  const rbac = read('deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml');
  ok('CD Role: the 3 backup SealedSecrets name-scoped', /resourceNames: \["radar-db-ro-prod", "radar-pra-admin-prod", "radar-backup-writer", "radar-backup-reader", "radar-backup-purger"\]/.test(rbac));
  ok('CD Role: both CronJobs + script ConfigMap name-scoped', /"radar-backup-daily", "radar-backup-freshness"\]/.test(rbac) && /"radar-backup-daily-script"\]/.test(rbac));
  const wf = read('.github/workflows/bascule-bundle-cd.yml');
  ok('CD workflow: path trigger + arming var + 3 SealedSecrets (fail-closed on placeholder) + ConfigMap + 2 CronJobs',
    wf.includes("'deploy/ci/backup/**'") && wf.includes('BACKUP_DAILY_CD_ENABLED') && wf.includes('for id in writer reader purger') &&
    wf.includes("grep -q '^kind: SealedSecret'") && wf.includes('radar-backup-daily-script') && wf.includes('cronjob-backup-daily.yaml') &&
    wf.includes('cronjob-backup-freshness.yaml'));
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
