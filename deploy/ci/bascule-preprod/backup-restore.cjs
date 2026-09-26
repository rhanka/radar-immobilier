'use strict';
// =============================================================================
// backup-restore.cjs — IN-POD steps of the preprod bascule MODE=restore|list:
// restore preprod FROM a daily backup of radar-immobilier-backup
// (deploy/ci/backup/: pg/<D>/radar.dump, docs/, docs-inventory/<D>.json,
// manifests/<D>.json, manifests/latest.json).
//
// This file is NEVER run on the GitHub runner. restore-mode.mjs embeds it
// verbatim into the Job templates (`node -e`, image radar-api = Node +
// @aws-sdk/client-s3, 0 python, 0 new image) and the pod picks its step from
// BR_STEP:
//   resolve     backup-read Job, BEFORE quiesce (read-only, reader identity):
//               BACKUP_ID (latest | YYYY-MM-DD) → date D; guards: manifest status
//               'complete', 24 h age guard for `latest` (ALLOW_STALE_BACKUP), dump
//               sidecar sha256 == manifest, dump size == manifest, inventory present.
//               Emits the PIN (D + manifest/dump sha256) the later Jobs re-check.
//   list        backup-read Job (read-only): every dated manifest still listed
//               (date, status, size, schema, sha) — the runner prints it.
//   fetch-dump  initContainer of the DB restore Job (reader): re-reads manifest D
//               (sha256 must equal the PIN), downloads pg/D/radar.dump streaming a
//               sha256, refuses unless it equals the manifest, the sidecar and the PIN.
//   docs        docs restore Job (reader + copy identity): restores into the preprod
//               docs bucket the docs state AT DAY D from docs-inventory/D.json by
//               server-side CopyObject from <backup>/docs/<key>?versionId=<v> (the
//               version whose ETag is the inventory's when the key was rewritten
//               since), ADDITIVE (no delete), then recon dest ⊇ inventory(D).
//               DOCS_DRY=1 = plan only (versions resolvable?), no copy.
//   recon       same Job template, recon only (G4 re-check before the flip).
//
// VERDICT ONLY: logs and the termination message (/dev/termination-log, read by
// the runner from the pod .status — never `kubectl logs`) carry dates, statuses,
// sizes, sha256 and COUNTS. Never a doc key, a row or a credential.
//
// EXIT: 0 ok · 1 error (network, S3, integrity mismatch) · 2 refusal (guard).
// =============================================================================
/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const process = require('node:process');
const console = require('node:console');
const { Buffer } = require('node:buffer');
const { once } = require('node:events');

const EXIT = Object.freeze({ OK: 0, ERROR: 1, REFUSED: 2 });
class RestoreError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = 'RestoreError';
    this.exitCode = exitCode;
  }
}
const refused = (message) => new RestoreError(EXIT.REFUSED, message);
const failed = (message) => new RestoreError(EXIT.ERROR, message);

const HOUR_MS = 3600000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const TERMINATION_MAX_BYTES = 3900; // k8s caps a container termination message at 4096 bytes
const LAYOUT = Object.freeze({
  docsPrefix: 'docs/',
  manifestsPrefix: 'manifests/',
  latestKey: 'manifests/latest.json',
  manifestFormat: 'radar-backup-manifest/v1',
  inventoryFormat: 'radar-backup-docs-inventory/v1',
});

// ── pure helpers ─────────────────────────────────────────────────────────────
function isValidDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const ms = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}
function keysFor(date) {
  return {
    dump: `pg/${date}/radar.dump`,
    dumpSha: `pg/${date}/radar.dump.sha256`,
    inventory: `docs-inventory/${date}.json`,
    manifest: `manifests/${date}.json`,
  };
}
function withScheme(endpoint) {
  const e = String(endpoint || '').trim();
  if (!e) return '';
  return /^https?:\/\//i.test(e) ? e : 'https://' + e;
}
function encodeKey(k) { return encodeURIComponent(k).replace(/%2F/g, '/'); }
function normEtag(e) { return e ? String(e).replace(/"/g, '').trim() : ''; }
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function safeToken(v) { const s = String(v ?? ''); return /^[a-z0-9._-]{1,32}$/i.test(s) ? s : 'invalid'; }
function parseSha256Line(text) {
  const m = /^([0-9a-f]{64})\s+\*?(\S.*)$/.exec(String(text || '').trim());
  return m ? m[1] : null;
}
function errName(e) {
  const status = e && e.$metadata && e.$metadata.httpStatusCode;
  return `${(e && (e.name || e.Code || e.code)) || 'Error'}${status ? '/' + status : ''}`;
}
function isNotFound(e) {
  const status = e && e.$metadata && e.$metadata.httpStatusCode;
  return status === 404 || (e && ['NoSuchKey', 'NotFound', 'NoSuchVersion'].includes(e.name));
}

// BACKUP_ID = 'latest' (default) or an explicit UTC date. The raw value is never
// echoed back (it comes from a workflow input).
function parseBackupId(raw, today) {
  const id = String(raw ?? '').trim();
  if (id === '' || id === 'latest') return { kind: 'latest', id: 'latest' };
  if (!isValidDate(id)) throw refused("BACKUP_ID must be 'latest' or a valid YYYY-MM-DD date");
  if (today && id > today) throw refused(`BACKUP_ID ${id} is in the future (today ${today} UTC)`);
  return { kind: 'date', id, date: id };
}

// latest → manifests/latest.json latestComplete (never the newest partial/incomplete).
function chooseDate(parsed, latest) {
  if (parsed.kind === 'date') return { date: parsed.date, source: 'explicit', pointerSha256: null };
  if (!latest || typeof latest !== 'object') throw refused('manifests/latest.json is missing or unreadable: no backup to resolve');
  const lc = latest.latestComplete;
  if (!lc || !isValidDate(lc.date)) throw refused('manifests/latest.json records no complete backup (latestComplete is empty)');
  const k = keysFor(lc.date);
  if (lc.manifestKey && lc.manifestKey !== k.manifest) throw refused('manifests/latest.json latestComplete.manifestKey does not match its date');
  // The pointer's manifestSha256 describes the NEWEST backup; usable only when it is D.
  const pointerSha256 = latest.date === lc.date && latest.manifestKey === k.manifest && SHA_RE.test(String(latest.manifestSha256 || ''))
    ? latest.manifestSha256 : null;
  return { date: lc.date, source: 'latestComplete', pointerSha256 };
}

// A manifest is restorable only when it is the complete record of day D.
function checkManifest(m, date) {
  if (!m || typeof m !== 'object') throw refused(`manifest of ${date} is missing or unreadable (never written, or purged by the retention)`);
  if (m.status !== 'complete') throw refused(`backup ${date} has status '${safeToken(m.status)}' — restore requires 'complete'`);
  const k = keysFor(date);
  const problems = [];
  if (m.format !== LAYOUT.manifestFormat) problems.push('unknown manifest format');
  if (m.date !== date) problems.push('manifest date differs from the requested date');
  if (!m.pg || m.pg.key !== k.dump) problems.push('pg.key is not pg/<date>/radar.dump');
  if (!m.pg || !SHA_RE.test(String(m.pg.sha256 || ''))) problems.push('pg.sha256 missing');
  if (!m.pg || !(Number(m.pg.sizeBytes) > 0)) problems.push('pg.sizeBytes missing');
  if (!m.docs || m.docs.inventoryKey !== k.inventory) problems.push('docs.inventoryKey is not docs-inventory/<date>.json');
  if (!m.docs || !SHA_RE.test(String(m.docs.inventorySha256 || ''))) problems.push('docs.inventorySha256 missing');
  if (problems.length) throw refused(`manifest ${date} rejected: ${problems.join('; ')}`);
  return m;
}

// Age reference = the data point of the backup: the dump start (RPO point), then
// the backup start, then its completion, then D at 00:00 UTC.
function backupReferenceTime(m) {
  const candidates = [
    ['pg.dumpStartedAt', m && m.pg && m.pg.dumpStartedAt],
    ['startedAt', m && m.startedAt],
    ['completedAt', m && m.completedAt],
    ['date', m && isValidDate(m.date) ? m.date + 'T00:00:00Z' : null],
  ];
  for (const [source, at] of candidates) {
    if (at && Number.isFinite(Date.parse(at))) return { source, at: new Date(Date.parse(at)).toISOString() };
  }
  return { source: 'unknown', at: null };
}

// `latest` older than maxAgeHours → refusal unless allowStale. An explicit date
// is never blocked by its age (logged only).
function staleGuard({ parsed, manifest, nowMs, maxAgeHours = 24, allowStale = false }) {
  const ref = backupReferenceTime(manifest);
  const ageHours = ref.at ? Math.round(((nowMs - Date.parse(ref.at)) / HOUR_MS) * 10) / 10 : null;
  const stale = ageHours === null || ageHours > maxAgeHours;
  if (parsed.kind === 'latest' && stale && !allowStale) {
    throw refused(`latest complete backup ${manifest.date} is ${ageHours === null ? 'of unknown age' : ageHours + ' h old'} ` +
      `(> ${maxAgeHours} h, reference ${ref.source}); set ALLOW_STALE_BACKUP=true or pass BACKUP_ID=${manifest.date} explicitly`);
  }
  return {
    ageHours, stale, reference: ref.source, referenceAt: ref.at,
    overridden: parsed.kind === 'latest' && stale && !!allowStale,
    blocking: parsed.kind === 'latest',
  };
}

// Inventory of day D, checked against its manifest (sha256 over the exact bytes).
function checkInventory(inv, { manifest, date, sha256 }) {
  if (sha256 !== manifest.docs.inventorySha256) throw failed(`docs-inventory/${date}.json sha256 differs from the manifest`);
  const problems = [];
  if (!inv || typeof inv !== 'object') throw failed(`docs-inventory/${date}.json unreadable`);
  if (inv.format !== LAYOUT.inventoryFormat) problems.push('unknown inventory format');
  if (inv.date !== date) problems.push('inventory date differs');
  if (!Array.isArray(inv.objects)) problems.push('objects missing');
  else {
    if (inv.counts && Number(inv.counts.objects) !== inv.objects.length) problems.push('counts.objects differs from objects');
    if (Number.isFinite(Number(manifest.docs.objects)) && Number(manifest.docs.objects) !== inv.objects.length) problems.push('manifest docs.objects differs from the inventory');
  }
  if (!Number.isFinite(Date.parse(inv.createdAt))) problems.push('createdAt missing');
  if (problems.length) throw failed(`docs-inventory/${date}.json rejected: ${problems.join('; ')}`);
  return inv;
}

// ListObjectVersions output → Map key(without docs/) → versions. Delete markers
// are listed apart by S3 and never restored.
function indexVersions(versions, prefix = LAYOUT.docsPrefix) {
  const idx = new Map();
  for (const v of versions || []) {
    if (!v || typeof v.Key !== 'string' || !v.Key.startsWith(prefix)) continue;
    const key = v.Key.slice(prefix.length);
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push({
      versionId: v.VersionId === undefined || v.VersionId === null ? null : String(v.VersionId),
      etag: normEtag(v.ETag),
      size: Number(v.Size),
      lastModified: v.LastModified ? new Date(v.LastModified).getTime() : NaN,
    });
  }
  return idx;
}

// Which backup version of a `backed-up` inventory entry holds the content of D:
//   1. the recorded versionId (size and ETag must agree);
//   2. else a version whose ETag = the inventory backupEtag and size = the entry
//      size: the newest one written not after the inventory, else the oldest
//      identical one written later (same ETag + size = same content).
function chooseVersion(entry, versions, inventoryCreatedAtMs) {
  const list = versions || [];
  const want = normEtag(entry.backupEtag);
  const size = Number(entry.size);
  if (entry.versionId) {
    const exact = list.find((v) => v.versionId === String(entry.versionId));
    if (exact) {
      if (exact.size !== size) return { error: 'size-mismatch' };
      if (want && exact.etag && exact.etag !== want) return { error: 'etag-mismatch' };
      return { versionId: exact.versionId, how: 'version-id' };
    }
  }
  if (!want) return { error: entry.versionId ? 'version-gone' : 'no-backup-etag' };
  const same = list.filter((v) => v.etag === want && v.size === size);
  if (!same.length) return { error: list.length ? 'etag-not-found' : 'no-version' };
  const before = same.filter((v) => Number.isFinite(v.lastModified) && v.lastModified <= inventoryCreatedAtMs)
    .sort((a, b) => b.lastModified - a.lastModified);
  if (before.length) return { versionId: before[0].versionId, how: 'etag-before-inventory' };
  const later = [...same].sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
  return { versionId: later[0].versionId, how: 'etag-identical-later' };
}

// Preprod already holds the content of D: same size AND same ETag (source or backup copy).
function destUpToDate(entry, d) {
  if (!d || Number(d.Size) !== Number(entry.size)) return false;
  const de = normEtag(d.ETag);
  return !!de && (de === normEtag(entry.etag) || de === normEtag(entry.backupEtag));
}

function planDocsRestore({ inventory, versionsIndex, destIndex }) {
  const createdAtMs = Date.parse(inventory.createdAt);
  const plan = { objects: 0, upToDate: 0, notInBackup: 0, unresolved: 0, unresolvedReasons: {}, toCopy: [], bytesToCopy: 0, how: {} };
  for (const e of inventory.objects) {
    plan.objects += 1;
    if (e.state !== 'backed-up') { plan.notInBackup += 1; continue; }
    if (destUpToDate(e, destIndex.get(e.key))) { plan.upToDate += 1; continue; }
    const c = chooseVersion(e, versionsIndex.get(e.key), createdAtMs);
    if (c.error) {
      plan.unresolved += 1;
      plan.unresolvedReasons[c.error] = (plan.unresolvedReasons[c.error] || 0) + 1;
      continue;
    }
    plan.toCopy.push({ key: e.key, versionId: c.versionId, size: Number(e.size) });
    plan.bytesToCopy += Number(e.size) || 0;
    plan.how[c.how] = (plan.how[c.how] || 0) + 1;
  }
  return plan;
}

// dest ⊇ inventory(D), Key + Size (same rule as the chain recon; ETag ignored:
// a server-side copy of a multipart object may re-chunk). Extra preprod objects
// (newer than D) are tolerated and counted: the restore is additive.
function reconInventory(inventory, destIndex) {
  const r = { checked: 0, missing: 0, sizeMismatch: 0, notInBackup: 0, extra: 0 };
  const keys = new Set();
  for (const e of inventory.objects) {
    keys.add(e.key);
    if (e.state !== 'backed-up') { r.notInBackup += 1; continue; }
    r.checked += 1;
    const d = destIndex.get(e.key);
    if (!d) r.missing += 1;
    else if (Number(d.Size) !== Number(e.size)) r.sizeMismatch += 1;
  }
  for (const k of destIndex.keys()) if (!keys.has(k)) r.extra += 1;
  r.ok = r.missing === 0 && r.sizeMismatch === 0 && r.notInBackup === 0;
  return r;
}

function copySourceFor(bucket, key, versionId) {
  const base = '/' + bucket + '/' + encodeKey(LAYOUT.docsPrefix + key);
  return versionId ? base + '?versionId=' + encodeURIComponent(versionId) : base;
}

// Compact listing for the runner (fits a termination message; oldest dropped first).
function buildListing({ bucket, latest, manifests, maxBytes = TERMINATION_MAX_BYTES }) {
  const backups = [...manifests]
    .filter((m) => m && isValidDate(m.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((m) => ({
      date: m.date,
      status: safeToken(m.status),
      pgBytes: Number(m.pg && m.pg.sizeBytes) || null,
      pgSha256: m.pg && SHA_RE.test(String(m.pg.sha256 || '')) ? m.pg.sha256.slice(0, 16) : null,
      migrations: m.schema && Number.isFinite(Number(m.schema.migrationsApplied)) ? Number(m.schema.migrationsApplied) : null,
      lastTag: m.schema && m.schema.lastMigration && typeof m.schema.lastMigration.tag === 'string' ? safeToken(m.schema.lastMigration.tag) : null,
      docs: m.docs && Number.isFinite(Number(m.docs.objects)) ? Number(m.docs.objects) : null,
      code: m.code && /^[0-9a-f]{7,40}$/.test(String(m.code.servedSha || '')) ? m.code.servedSha.slice(0, 7) : null,
      startedAt: backupReferenceTime(m).at,
    }));
  const out = {
    v: 1, tenant: 'immo', bucket,
    latest: latest && isValidDate(latest.date) ? latest.date : null,
    latestComplete: latest && latest.latestComplete && isValidDate(latest.latestComplete.date) ? latest.latestComplete.date : null,
    count: backups.length, truncated: false, backups,
  };
  while (Buffer.byteLength(JSON.stringify(out)) > maxBytes && out.backups.length > 1) {
    out.backups.pop();
    out.truncated = true;
  }
  return out;
}

// ── config ───────────────────────────────────────────────────────────────────
function readConfig(env, step) {
  const req = (name) => {
    const v = String(env[name] || '').trim();
    if (!v) throw refused(`missing ${name}`);
    return v;
  };
  const cfg = {
    step,
    endpoint: withScheme(req('S3_ENDPOINT')),
    region: String(env.S3_REGION || '').trim() || 'us-east-1',
    forcePathStyle: String(env.S3_FORCE_PATH_STYLE || 'true').trim() !== 'false',
    reader: { accessKeyId: req('READER_ACCESS_KEY'), secretAccessKey: req('READER_SECRET_KEY') },
    backupBucket: req('BACKUP_BUCKET'),
    expectedBackupBucket: String(env.EXPECTED_BACKUP_BUCKET || '').trim(),
    workDir: String(env.WORK_DIR || '/work'),
    terminationLog: String(env.TERMINATION_LOG || '/dev/termination-log'),
  };
  // Positive bucket guard: a mis-provisioned Secret must never make us read another bucket.
  if (cfg.expectedBackupBucket && cfg.backupBucket !== cfg.expectedBackupBucket) {
    throw refused('BACKUP_BUCKET (reader Secret) differs from EXPECTED_BACKUP_BUCKET');
  }
  if (step === 'resolve') {
    cfg.backupId = String(env.BACKUP_ID || 'latest');
    cfg.allowStale = String(env.ALLOW_STALE_BACKUP || 'false').trim() === 'true';
    const h = Number(String(env.MAX_AGE_HOURS || '24').trim());
    if (!Number.isFinite(h) || h <= 0) throw refused('invalid MAX_AGE_HOURS');
    cfg.maxAgeHours = h;
  }
  if (['fetch-dump', 'docs', 'recon'].includes(step)) {
    cfg.date = req('BACKUP_DATE');
    if (!isValidDate(cfg.date)) throw refused('invalid BACKUP_DATE');
    cfg.pinManifestSha256 = req('PIN_MANIFEST_SHA256');
    if (!SHA_RE.test(cfg.pinManifestSha256)) throw refused('invalid PIN_MANIFEST_SHA256');
  }
  if (step === 'fetch-dump') {
    cfg.pinPgSha256 = req('PIN_PG_SHA256');
    if (!SHA_RE.test(cfg.pinPgSha256)) throw refused('invalid PIN_PG_SHA256');
  }
  if (step === 'docs' || step === 'recon') {
    cfg.copier = { accessKeyId: req('COPIER_ACCESS_KEY'), secretAccessKey: req('COPIER_SECRET_KEY') };
    cfg.dstBucket = req('DST_BUCKET');
    cfg.grantee = String(env.COPY_GRANTEE || '').trim();
    cfg.dry = String(env.DOCS_DRY || '0').trim() === '1';
    const c = Math.floor(Number(env.COPY_CONCURRENCY || '8'));
    cfg.concurrency = Number.isFinite(c) ? Math.max(1, Math.min(32, c)) : 8;
    const forbidden = String(env.FORBIDDEN_DST_BUCKETS || '').split(',').map((s) => s.trim()).filter(Boolean);
    // Never write into the backup bucket nor into a production bucket.
    if (cfg.dstBucket === cfg.backupBucket || forbidden.includes(cfg.dstBucket)) {
      throw refused('DST_BUCKET is the backup bucket or a forbidden (production) bucket');
    }
  }
  return cfg;
}

// ── S3 helpers (client + sdk injected: the selftest passes an in-memory fake) ─
async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  const chunks = [];
  for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}
async function getBufferOrNull(c, Bucket, Key, VersionId) {
  try {
    const got = await c.s3.send(new c.sdk.GetObjectCommand(VersionId ? { Bucket, Key, VersionId } : { Bucket, Key }));
    return { buf: await bodyToBuffer(got.Body), versionId: got.VersionId || null };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}
async function getJsonWithSha(c, Bucket, Key) {
  const got = await getBufferOrNull(c, Bucket, Key);
  if (!got) return null;
  let json = null;
  try { json = JSON.parse(got.buf.toString('utf8')); } catch { json = null; }
  return { json, sha256: sha256Hex(got.buf), versionId: got.versionId, bytes: got.buf.length };
}
async function headOrNull(c, Bucket, Key) {
  try { return await c.s3.send(new c.sdk.HeadObjectCommand({ Bucket, Key })); } catch (e) { if (isNotFound(e)) return null; throw e; }
}
async function listAll(c, Bucket, Prefix) {
  const all = [];
  let ContinuationToken;
  do {
    const out = await c.s3.send(new c.sdk.ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    for (const o of out.Contents || []) all.push(o);
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return all;
}
async function listAllVersions(c, Bucket, Prefix) {
  const all = [];
  let KeyMarker; let VersionIdMarker;
  do {
    const out = await c.s3.send(new c.sdk.ListObjectVersionsCommand({ Bucket, Prefix, KeyMarker, VersionIdMarker }));
    for (const v of out.Versions || []) all.push(v);
    const more = !!out.IsTruncated;
    KeyMarker = more ? out.NextKeyMarker : undefined;
    VersionIdMarker = more ? out.NextVersionIdMarker : undefined;
  } while (KeyMarker);
  return all;
}
async function downloadWithSha(c, Bucket, Key, VersionId, file) {
  const got = await c.s3.send(new c.sdk.GetObjectCommand(VersionId ? { Bucket, Key, VersionId } : { Bucket, Key }));
  const h = crypto.createHash('sha256');
  let size = 0;
  const out = fs.createWriteStream(file, { mode: 0o600 });
  for await (const chunk of got.Body) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    h.update(b);
    size += b.length;
    if (!out.write(b)) await once(out, 'drain');
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  return { sha256: h.digest('hex'), size };
}
function writeTermination(file, obj) {
  let text = JSON.stringify(obj);
  if (Buffer.byteLength(text) > TERMINATION_MAX_BYTES) text = JSON.stringify({ ok: obj.ok, step: obj.step, truncated: true });
  try { fs.writeFileSync(file, text); } catch { /* best-effort: the exit code stays the verdict */ }
}

// Manifest D re-read by every later Job: its sha256 must equal the PIN taken by
// `resolve` (a same-day manual backup re-run rewrites manifests/D.json).
async function loadPinnedManifest(c, cfg) {
  const k = keysFor(cfg.date);
  const got = await getJsonWithSha(c, cfg.backupBucket, k.manifest);
  if (!got) throw refused(`manifest ${cfg.date} no longer readable`);
  if (got.sha256 !== cfg.pinManifestSha256) throw refused(`manifest ${cfg.date} changed since resolve (sha256 differs from the PIN): re-run the bascule`);
  return checkManifest(got.json, cfg.date);
}
async function loadInventory(c, cfg, manifest) {
  const got = await getBufferOrNull(c, cfg.backupBucket, manifest.docs.inventoryKey);
  if (!got) throw failed(`docs-inventory/${cfg.date}.json not readable`);
  let inv = null;
  try { inv = JSON.parse(got.buf.toString('utf8')); } catch { inv = null; }
  return checkInventory(inv, { manifest, date: cfg.date, sha256: sha256Hex(got.buf) });
}
async function destIndexOf(c, bucket) {
  const idx = new Map();
  for (const o of await listAll(c, bucket, undefined)) idx.set(o.Key, o);
  return idx;
}

// ── steps ────────────────────────────────────────────────────────────────────
async function runResolve({ cfg, reader, now, log }) {
  const today = new Date(now()).toISOString().slice(0, 10);
  const parsed = parseBackupId(cfg.backupId, today);
  const latestGot = await getJsonWithSha(reader, cfg.backupBucket, LAYOUT.latestKey);
  const choice = chooseDate(parsed, latestGot && latestGot.json);
  const date = choice.date;
  const k = keysFor(date);
  const got = await getJsonWithSha(reader, cfg.backupBucket, k.manifest);
  const manifest = checkManifest(got && got.json, date);
  if (choice.pointerSha256 && choice.pointerSha256 !== got.sha256) throw failed(`manifest ${date} sha256 differs from manifests/latest.json`);
  const guard = staleGuard({ parsed, manifest, nowMs: now(), maxAgeHours: cfg.maxAgeHours, allowStale: cfg.allowStale });
  const side = await getBufferOrNull(reader, cfg.backupBucket, k.dumpSha);
  const sideSha = side ? parseSha256Line(side.buf.toString('utf8')) : null;
  if (sideSha !== manifest.pg.sha256) throw failed(`pg/${date}/radar.dump.sha256 missing or different from the manifest`);
  const head = await headOrNull(reader, cfg.backupBucket, k.dump);
  if (!head || Number(head.ContentLength) !== Number(manifest.pg.sizeBytes)) throw failed(`pg/${date}/radar.dump missing or its size differs from the manifest`);
  const inv = await headOrNull(reader, cfg.backupBucket, k.inventory);
  if (!inv || !(Number(inv.ContentLength) > 0)) throw failed(`docs-inventory/${date}.json missing`);
  const pin = {
    ok: true, step: 'resolve', v: 1,
    backupId: parsed.id, date, source: choice.source, status: manifest.status,
    manifestKey: k.manifest, manifestSha256: got.sha256,
    pgKey: k.dump, pgSha256: manifest.pg.sha256, pgSizeBytes: Number(manifest.pg.sizeBytes),
    inventoryKey: k.inventory, inventorySha256: manifest.docs.inventorySha256,
    docsObjects: Number.isFinite(Number(manifest.docs.objects)) ? Number(manifest.docs.objects) : null,
    migrations: manifest.schema && Number.isFinite(Number(manifest.schema.migrationsApplied)) ? Number(manifest.schema.migrationsApplied) : null,
    lastTag: manifest.schema && manifest.schema.lastMigration && typeof manifest.schema.lastMigration.tag === 'string' ? safeToken(manifest.schema.lastMigration.tag) : null,
    codeSha: manifest.code && /^[0-9a-f]{7,40}$/.test(String(manifest.code.servedSha || '')) ? manifest.code.servedSha : null,
    dumpStartedAt: guard.referenceAt, ageHours: guard.ageHours, ageReference: guard.reference,
    stale: guard.stale, staleOverridden: guard.overridden, ageBlocking: guard.blocking,
  };
  if (guard.stale && !guard.blocking) log(`WARN backup ${date} is ${guard.ageHours} h old (explicit BACKUP_ID: age not blocking)`);
  if (guard.overridden) log(`WARN latest backup ${date} is ${guard.ageHours} h old — accepted by ALLOW_STALE_BACKUP=true`);
  log(`RESOLVE OK backup_id=${parsed.id} date=${date} status=complete age_h=${guard.ageHours} pg.bytes=${pin.pgSizeBytes} ` +
    `pg.sha256=${pin.pgSha256} manifest.sha256=${pin.manifestSha256} docs.objects=${pin.docsObjects} migrations=${pin.migrations}`);
  return { exitCode: EXIT.OK, termination: pin };
}

async function runList({ cfg, reader, log }) {
  const latestGot = await getJsonWithSha(reader, cfg.backupBucket, LAYOUT.latestKey);
  const keys = (await listAll(reader, cfg.backupBucket, LAYOUT.manifestsPrefix))
    .map((o) => o.Key).filter((key) => /^manifests\/\d{4}-\d{2}-\d{2}\.json$/.test(key)).sort().reverse();
  const manifests = [];
  for (const key of keys) {
    const got = await getJsonWithSha(reader, cfg.backupBucket, key);
    if (got && got.json) manifests.push(got.json);
  }
  const listing = buildListing({ bucket: cfg.backupBucket, latest: latestGot && latestGot.json, manifests });
  log(`LIST OK backups=${listing.count} latest=${listing.latest} latest_complete=${listing.latestComplete}` +
    `${listing.truncated ? ' (termination message truncated to the newest ' + listing.backups.length + ')' : ''}`);
  return { exitCode: EXIT.OK, termination: { ok: true, step: 'list', ...listing } };
}

async function runFetchDump({ cfg, reader, log }) {
  const manifest = await loadPinnedManifest(reader, cfg);
  if (manifest.pg.sha256 !== cfg.pinPgSha256) throw refused('manifest pg.sha256 differs from the PIN');
  const k = keysFor(cfg.date);
  const side = await getBufferOrNull(reader, cfg.backupBucket, k.dumpSha);
  if (!side || parseSha256Line(side.buf.toString('utf8')) !== manifest.pg.sha256) throw failed('dump sidecar sha256 missing or different from the manifest');
  await fsp.mkdir(cfg.workDir, { recursive: true });
  const file = path.join(cfg.workDir, 'radar.dump');
  const got = await downloadWithSha(reader, cfg.backupBucket, k.dump, manifest.pg.versionId || null, file);
  if (got.size !== Number(manifest.pg.sizeBytes)) throw failed(`dump size ${got.size} differs from the manifest ${manifest.pg.sizeBytes}`);
  if (got.sha256 !== manifest.pg.sha256) throw failed('dump sha256 differs from the manifest (restore refused)');
  const facts = [
    `BACKUP_DATE=${cfg.date}`,
    `PG_SHA256=${got.sha256}`,
    `EXPECTED_TOC_ENTRIES=${Number.isFinite(Number(manifest.pg.tocEntries)) ? Number(manifest.pg.tocEntries) : ''}`,
    `DUMP_DATABASE=${safeToken(manifest.pg.database)}`,
  ].join('\n') + '\n';
  await fsp.writeFile(path.join(cfg.workDir, 'backup.env'), facts, { mode: 0o600 });
  log(`FETCH OK date=${cfg.date} bytes=${got.size} sha256=${got.sha256} (== manifest == sidecar == PIN)`);
  return { exitCode: EXIT.OK, termination: { ok: true, step: 'fetch-dump', date: cfg.date, pgSha256: got.sha256, pgSizeBytes: got.size } };
}

async function runDocs({ cfg, reader, copier, log }) {
  const manifest = await loadPinnedManifest(reader, cfg);
  const inventory = await loadInventory(reader, cfg, manifest);
  const versionsIndex = indexVersions(await listAllVersions(reader, cfg.backupBucket, LAYOUT.docsPrefix));
  const destIndex = await destIndexOf(copier, cfg.dstBucket);
  const plan = planDocsRestore({ inventory, versionsIndex, destIndex });
  log(`PLAN date=${cfg.date} inventory=${plan.objects} up_to_date=${plan.upToDate} to_copy=${plan.toCopy.length} ` +
    `bytes_to_copy=${plan.bytesToCopy} not_in_backup=${plan.notInBackup} unresolved=${plan.unresolved} ` +
    `reasons=${JSON.stringify(plan.unresolvedReasons)} how=${JSON.stringify(plan.how)} dest_objects=${destIndex.size} dry=${cfg.dry}`);
  const base = { step: 'docs', date: cfg.date, dry: cfg.dry, inventory: plan.objects, upToDate: plan.upToDate, toCopy: plan.toCopy.length,
    bytesToCopy: plan.bytesToCopy, notInBackup: plan.notInBackup, unresolved: plan.unresolved, unresolvedReasons: plan.unresolvedReasons };
  if (plan.notInBackup > 0 || plan.unresolved > 0) {
    log(`DOCS REFUSED — ${plan.notInBackup} inventory object(s) not in the backup of ${cfg.date}, ${plan.unresolved} without a restorable version (fail-closed)`);
    return { exitCode: EXIT.REFUSED, termination: { ok: false, ...base } };
  }
  if (cfg.dry) {
    log('DOCS DRY OK — every object of the inventory is restorable (no copy done)');
    return { exitCode: EXIT.OK, termination: { ok: true, ...base, copied: 0 } };
  }
  const grant = cfg.grantee ? { GrantFullControl: 'id=' + cfg.grantee } : {};
  if (!cfg.grantee) log('WARN COPY_GRANTEE empty: copied objects may be unreadable by the preprod API (403)');
  let next = 0; let copied = 0; let copyErrors = 0; let errorsLogged = 0;
  const worker = async () => {
    while (next < plan.toCopy.length) {
      const item = plan.toCopy[next++];
      try {
        await copier.s3.send(new copier.sdk.CopyObjectCommand({
          Bucket: cfg.dstBucket, Key: item.key, CopySource: copySourceFor(cfg.backupBucket, item.key, item.versionId),
          MetadataDirective: 'COPY', ...grant,
        }));
        copied += 1;
      } catch (e) {
        copyErrors += 1;
        if (errorsLogged < 5) { errorsLogged += 1; log(`copy error ${errName(e)} (object key not logged)`); }
      }
      const done = copied + copyErrors;
      if (done % 1000 === 0) log(`progress ${done}/${plan.toCopy.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, plan.toCopy.length) }, () => worker()));
  const recon = reconInventory(inventory, await destIndexOf(copier, cfg.dstBucket));
  const ok = copyErrors === 0 && recon.ok;
  log(`${ok ? 'DOCS OK' : 'DOCS FAIL'} date=${cfg.date} copied=${copied} copy_errors=${copyErrors} recon.checked=${recon.checked} ` +
    `recon.missing=${recon.missing} recon.size_mismatch=${recon.sizeMismatch} dest_extra=${recon.extra} (additive: extra objects kept)`);
  return { exitCode: ok ? EXIT.OK : EXIT.ERROR, termination: { ok, ...base, copied, copyErrors, recon } };
}

async function runRecon({ cfg, reader, copier, log }) {
  const manifest = await loadPinnedManifest(reader, cfg);
  const inventory = await loadInventory(reader, cfg, manifest);
  const recon = reconInventory(inventory, await destIndexOf(copier, cfg.dstBucket));
  log(`${recon.ok ? 'RECON OK' : 'RECON FAIL'} date=${cfg.date} checked=${recon.checked} missing=${recon.missing} ` +
    `size_mismatch=${recon.sizeMismatch} not_in_backup=${recon.notInBackup} dest_extra=${recon.extra}`);
  return { exitCode: recon.ok ? EXIT.OK : EXIT.ERROR, termination: { ok: recon.ok, step: 'recon', date: cfg.date, ...recon } };
}

const STEPS = { resolve: runResolve, list: runList, 'fetch-dump': runFetchDump, docs: runDocs, recon: runRecon };

function makeClient(sdk, cfg, creds) {
  return new sdk.S3Client({
    endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: cfg.forcePathStyle,
    credentials: creds, maxAttempts: 5,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

// Entry shared by the pod and the selftest (sdk + clients injectable).
async function runStep({ env, sdk, clients, now = Date.now, log }) {
  const step = String(env.BR_STEP || '').trim();
  const terminationLog = String(env.TERMINATION_LOG || '/dev/termination-log');
  try {
    if (!STEPS[step]) throw refused('unknown BR_STEP');
    if (!sdk) throw failed('@aws-sdk/client-s3 not resolvable (radar-api image expected)');
    const cfg = readConfig(env, step);
    const reader = { sdk, s3: (clients && clients.reader) || makeClient(sdk, cfg, cfg.reader) };
    const copier = cfg.copier ? { sdk, s3: (clients && clients.copier) || makeClient(sdk, cfg, cfg.copier) } : null;
    const r = await STEPS[step]({ cfg, reader, copier, now, log });
    writeTermination(terminationLog, r.termination);
    return r;
  } catch (e) {
    const code = e instanceof RestoreError ? e.exitCode : EXIT.ERROR;
    const reason = e instanceof RestoreError ? e.message : errName(e);
    writeTermination(terminationLog, { ok: false, step: safeToken(step), exit: code, reason });
    throw e;
  }
}

module.exports = {
  EXIT, RestoreError, LAYOUT, TERMINATION_MAX_BYTES, isValidDate, keysFor, withScheme, encodeKey, normEtag, parseSha256Line,
  parseBackupId, chooseDate, checkManifest, backupReferenceTime, staleGuard, checkInventory, indexVersions, chooseVersion,
  destUpToDate, planDocsRestore, reconInventory, copySourceFor, buildListing, readConfig, runStep,
};

if (require.main === module || module.id === '[eval]') {
  const step = String(process.env.BR_STEP || '?');
  const log = (m) => console.log(`[backup-restore:${safeToken(step)}] ${m}`);
  let sdk;
  try { sdk = require('@aws-sdk/client-s3'); } catch { sdk = null; }
  runStep({ env: process.env, sdk, log })
    .then((r) => process.exit(r.exitCode))
    .catch((e) => {
      const code = e instanceof RestoreError ? e.exitCode : EXIT.ERROR;
      log(`VERDICT FAIL exit=${code} ${e instanceof RestoreError ? e.message : errName(e)}`);
      process.exit(code);
    });
}
