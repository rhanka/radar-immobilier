'use strict';
// =============================================================================
// served-refs.cjs — IN-POD publisher of the immo zone references (e2e O1).
//
// Owner decision (O1): no HTTP endpoint. After S7, when CYCLE_ID is set, the Job
// radar-bascule-served-refs reads the RESTORED preprod database READ-ONLY
// (container `extract`, psql, default_transaction_read_only=on) and writes the
// distinct couples (city_slug, zone_code) immo references to /work/refs.tsv.
// This container (`publish`, image radar-api, embedded with `node -e`) then:
//   - validates the rows (slug [a-z0-9-], code without tab/newline, non-empty),
//     sorts them in byte order and deduplicates;
//   - gzips them and cuts the gzip into parts of at most PART_BYTES;
//   - REWRITES the pre-created ConfigMaps immo-served-refs-0..N-1 (fixed names,
//     `binaryData.refs.tsv.gz.part` + `data.meta.json`) through the Kubernetes API
//     with the ServiceAccount radar-bascule-refs-writer (configmaps get/update on
//     those names only; token projected into THIS container only).
// The runner (kubectl, configmaps get on the same names) reassembles the parts,
// checks CYCLE_ID + sha256 + row count, and hands the file to the job
// `served-ids` as an artefact. No pods/log, no S3 credential.
//
// Zone codes are public municipal zoning codes (Loi 25: no PII). Logs = counts.
// EXIT: 0 ok · 1 error · 2 refusal (empty result, too many parts, bad input).
// =============================================================================
/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const https = require('node:https');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const process = require('node:process');
const console = require('node:console');
const { Buffer } = require('node:buffer');

const EXIT = Object.freeze({ OK: 0, ERROR: 1, REFUSED: 2 });
class RefsError extends Error {
  constructor(exitCode, message) { super(message); this.name = 'RefsError'; this.exitCode = exitCode; }
}
const FORMAT = 'immo-served-refs/v1';
const PART_KEY = 'refs.tsv.gz.part';
const META_KEY = 'meta.json';
const PART_BYTES = 900 * 1024; // ConfigMap objects are capped at 1 MiB
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const CM_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const CYCLE_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;

function byteCmp(a, b) { return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')); }
function sha256Hex(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

// psql -At -F<TAB> output → validated, byte-sorted, deduplicated lines.
function parseRefsTsv(text) {
  const seen = new Set();
  let rejected = 0;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length !== 2 || !SLUG_RE.test(cols[0]) || !cols[1].trim() || /[\t\n\r]/.test(cols[1])) { rejected += 1; continue; }
    seen.add(`${cols[0]}\t${cols[1]}`);
  }
  const lines = [...seen].sort(byteCmp);
  return { lines, rejected };
}

function parseSources(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const [src, n] = line.split('\t');
    if (src && /^[a-z_]+$/.test(src) && /^\d+$/.test(String(n || '').trim())) out[src] = Number(n);
  }
  return out;
}

function splitParts(buf, partBytes = PART_BYTES) {
  const parts = [];
  for (let off = 0; off < buf.length; off += partBytes) parts.push(buf.subarray(off, off + partBytes));
  return parts.length ? parts : [Buffer.alloc(0)];
}

function configMapNames(prefix, count) {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
}

// Full ConfigMap object for a PUT (replace). meta.json in every part (same content).
function buildConfigMap({ namespace, name, part, meta, labels }) {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name, namespace, labels: { 'app.kubernetes.io/name': 'radar-immobilier', 'sentropic.io/bascule': 'served-refs', ...(labels || {}) } },
    data: { [META_KEY]: JSON.stringify(meta) },
    binaryData: { [PART_KEY]: Buffer.from(part).toString('base64') },
  };
}

function buildPayload({ lines, rejected, sources, cycleId, backupDate, maxParts, prefix, now }) {
  if (!lines.length) throw new RefsError(EXIT.REFUSED, 'no zone reference extracted from the restored database (fail-closed)');
  const tsv = Buffer.from(lines.join('\n') + '\n', 'utf8');
  const gz = zlib.gzipSync(tsv, { level: 9 });
  const parts = splitParts(gz);
  if (parts.length > maxParts) throw new RefsError(EXIT.REFUSED, `refs need ${parts.length} ConfigMaps (> ${maxParts} pre-created): ask k8s for more`);
  const meta = {
    format: FORMAT, cycleId, backupDate: backupDate || null, createdAt: new Date(now()).toISOString(),
    rows: lines.length, rejected, sources, tsvBytes: tsv.length, tsvSha256: sha256Hex(tsv),
    gzipBytes: gz.length, gzipSha256: sha256Hex(gz), parts: parts.length, names: configMapNames(prefix, parts.length),
  };
  return { meta, parts };
}

// ── in-cluster Kubernetes API (projected token + kube-root-ca) ───────────────
function k8sPut({ host, port, token, ca, namespace, name, body }) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, port, method: 'PUT', ca,
      path: `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${encodeURIComponent(name)}`,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': payload.length },
      timeout: 30000,
    }, (res) => {
      res.resume();
      res.on('end', () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve(res.statusCode) : reject(new Error(`PUT configmap ${name} → HTTP ${res.statusCode}`))));
    });
    req.on('timeout', () => req.destroy(new Error(`PUT configmap ${name} timeout`)));
    req.on('error', reject);
    req.end(payload);
  });
}

async function run({ env, readFile = (p) => fs.readFileSync(p, 'utf8'), put = k8sPut, now = Date.now, log }) {
  const cycleId = String(env.CYCLE_ID || '');
  if (!CYCLE_ID_RE.test(cycleId)) throw new RefsError(EXIT.REFUSED, 'invalid CYCLE_ID');
  const prefix = String(env.REFS_CONFIGMAP_PREFIX || 'immo-served-refs');
  const maxParts = Math.max(1, Math.min(16, Number(env.REFS_CONFIGMAP_COUNT || '4') || 4));
  const namespace = String(env.POD_NAMESPACE || '');
  if (!CM_NAME_RE.test(`${prefix}-${maxParts - 1}`) || !CM_NAME_RE.test(namespace)) throw new RefsError(EXIT.REFUSED, 'invalid ConfigMap prefix or namespace');
  const workDir = String(env.WORK_DIR || '/work');
  const { lines, rejected } = parseRefsTsv(readFile(`${workDir}/refs.tsv`));
  let sources = {};
  try { sources = parseSources(readFile(`${workDir}/sources.tsv`)); } catch { sources = {}; }
  const { meta, parts } = buildPayload({ lines, rejected, sources, cycleId, backupDate: env.BACKUP_DATE, maxParts, prefix, now });
  const tokenDir = String(env.KUBE_TOKEN_DIR || '/var/run/secrets/refs-writer');
  const api = {
    host: String(env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc'),
    port: Number(env.KUBERNETES_SERVICE_PORT || '443'),
    token: readFile(`${tokenDir}/token`).trim(),
    ca: readFile(`${tokenDir}/ca.crt`),
  };
  for (let i = 0; i < parts.length; i++) {
    await put({ ...api, namespace, name: meta.names[i], body: buildConfigMap({ namespace, name: meta.names[i], part: parts[i], meta: { ...meta, part: i } }) });
  }
  log(`REFS OK cycle=${cycleId} rows=${meta.rows} rejected=${rejected} sources=${JSON.stringify(sources)} gzip=${meta.gzipBytes}B ` +
    `sha256=${meta.gzipSha256} configmaps=${meta.names.join(',')}`);
  return { exitCode: EXIT.OK, meta };
}

module.exports = { EXIT, RefsError, FORMAT, PART_KEY, META_KEY, PART_BYTES, parseRefsTsv, parseSources, splitParts, buildConfigMap, buildPayload, configMapNames, run };

if (require.main === module || module.id === '[eval]') {
  const log = (m) => console.log(`[served-refs] ${m}`);
  run({ env: process.env, log })
    .then((r) => process.exit(r.exitCode))
    .catch((e) => {
      const code = e instanceof RefsError ? e.exitCode : EXIT.ERROR;
      log(`VERDICT FAIL exit=${code} ${e && e.message ? e.message : e}`);
      process.exit(code);
    });
}
