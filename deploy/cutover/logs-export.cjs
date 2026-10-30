// Cutover log export (R5): before any Pod of a slot disappears, every container log (current
// and previous instance) is copied to the recovery bucket with a verified manifest:
//   s3://<bucket>/cutover-logs/<env>/<run>/<slot>/<pod>/<container>[.previous].log.gz
// Runs in-cluster with the radar-cutover-logs ServiceAccount (get pods, get pods/log).
/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const process = require('node:process');
const fs = require('node:fs');
const https = require('node:https');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const SAFE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
function stats(text) {
  const lines = text.split('\n').filter(Boolean);
  const stamp = line => (/^(\d{4}-\d\d-\d\dT[0-9:.]+Z) /.exec(line) || [])[1] || null;
  return { lines: lines.length, firstAt: lines.length ? stamp(lines[0]) : null, lastAt: lines.length ? stamp(lines.at(-1)) : null };
}
async function exportLogs({ pods, prefix, k8s, s3, log = () => {} }) {
  const manifest = { format: 'radar-cutover-logs/v1', prefix, pods: [], missing: [] };
  for (const expected of pods) {
    const pod = await k8s.getPod(expected.name);
    if (!pod || pod.metadata.uid !== expected.uid || !SAFE.test(expected.name)) { manifest.missing.push(expected.uid); continue; }
    const entry = { name: expected.name, uid: expected.uid, containers: [] };
    const containers = [...(pod.spec.initContainers || []), ...pod.spec.containers].map(c => c.name);
    for (const container of containers) {
      for (const previous of [false, true]) {
        const text = await k8s.getLog(expected.name, container, previous);
        // No previous instance is a normal case; a missing current log is a failure.
        if (text === null) { if (!previous) manifest.missing.push(`${expected.uid}/${container}`); continue; }
        const body = zlib.gzipSync(Buffer.from(text));
        const key = `${prefix}/${expected.name}/${container}${previous ? '.previous' : ''}.log.gz`;
        await s3.put(key, body);
        const back = await s3.get(key);
        if (!back || sha256(back) !== sha256(body)) throw Error(`sha256 mismatch on re-read: ${key}`);
        entry.containers.push({ container, previous, key, sha256: sha256(body), bytes: body.length, ...stats(text) });
      }
    }
    manifest.pods.push(entry);
  }
  const body = Buffer.from(JSON.stringify(manifest));
  await s3.put(`${prefix}/manifest.json`, body);
  const back = await s3.get(`${prefix}/manifest.json`);
  if (!back || sha256(back) !== sha256(body)) throw Error('manifest sha256 mismatch on re-read');
  const exported = manifest.pods.map(p => p.uid);
  const complete = manifest.missing.length === 0 && pods.every(p => exported.includes(p.uid));
  log(`LOGS ${complete ? 'OK' : 'INCOMPLETE'} pods=${exported.length}/${pods.length} missing=${manifest.missing.length}`);
  return { ok: complete, podUids: exported, logContainers: manifest.pods.reduce((n, p) => n + p.containers.length, 0),
    logBytes: manifest.pods.reduce((n, p) => n + p.containers.reduce((m, c) => m + c.bytes, 0), 0),
    manifestSha256: sha256(body) };
}
function inClusterK8s() {
  const dir = '/var/run/secrets/kubernetes.io/serviceaccount';
  const token = fs.readFileSync(`${dir}/token`, 'utf8');
  const ca = fs.readFileSync(`${dir}/ca.crt`);
  const namespace = fs.readFileSync(`${dir}/namespace`, 'utf8').trim();
  const request = path => new Promise((resolve, reject) => {
    https.get({ host: process.env.KUBERNETES_SERVICE_HOST, port: process.env.KUBERNETES_SERVICE_PORT, path, ca,
      headers: { Authorization: `Bearer ${token}` } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  const base = `/api/v1/namespaces/${namespace}/pods`;
  return {
    async getPod(name) {
      const r = await request(`${base}/${name}`);
      return r.status === 200 ? JSON.parse(r.body.toString()) : null;
    },
    async getLog(name, container, previous) {
      const r = await request(`${base}/${name}/log?container=${encodeURIComponent(container)}&timestamps=true${previous ? '&previous=true' : ''}`);
      if (r.status === 200) return r.body.toString();
      if (previous && (r.status === 400 || r.status === 404)) return null;
      if (r.status === 404) return null;
      throw Error(`log read failed: ${r.status}`);
    },
  };
}
function s3Client(env) {
  const sdk = require('@aws-sdk/client-s3');
  const client = new sdk.S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } });
  return {
    put: (Key, Body) => client.send(new sdk.PutObjectCommand({ Bucket: env.LOG_BUCKET, Key, Body })),
    async get(Key) {
      const out = await client.send(new sdk.GetObjectCommand({ Bucket: env.LOG_BUCKET, Key }));
      return Buffer.from(await out.Body.transformToByteArray());
    },
  };
}
module.exports = { exportLogs };
if (require.main === module || module.id === '[eval]') {
  const env = process.env;
  const pods = JSON.parse(env.LOG_PODS || '[]');
  exportLogs({ pods, prefix: env.LOG_PREFIX, k8s: inClusterK8s(), s3: s3Client(env), log: m => process.stderr.write(`${m}\n`) })
    .then(verdict => {
      if (env.TERMINATION_LOG) fs.writeFileSync(env.TERMINATION_LOG, JSON.stringify(verdict));
      else process.stdout.write(JSON.stringify(verdict));
      process.exitCode = verdict.ok ? 0 : 1;
    })
    .catch(e => { process.stderr.write(`logs_export_failed ${e.message}\n`); process.exitCode = 1; });
}
