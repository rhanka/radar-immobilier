// Cutover log export (R5). Started BEFORE the listed Pods are deleted or re-rolled: it follows
// the current log of every container until that container exits (the SIGTERM drain lines
// included), reads the previous instance when there is one, and only then writes
//   s3://<bucket>/cutover-logs/<env>/<run>/<label><n>/<pod>/<container>[.previous].log.gz
// with a re-read sha256 manifest. Once every follow stream is open it creates the readiness
// file (LOG_READY_FILE): the controller deletes nothing before the Job Pod is Ready.
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
// k8s.openLog(pod, container, { previous, follow }) -> { opened: Promise<boolean>, text: Promise<string|null> }
async function exportLogs({ pods, prefix, k8s, s3, onOpen = () => {}, log = () => {} }) {
  const manifest = { format: 'radar-cutover-logs/v1', prefix, pods: [], missing: [] };
  const streams = [];
  for (const expected of pods) {
    const pod = await k8s.getPod(expected.name);
    if (!pod || pod.metadata.uid !== expected.uid || !SAFE.test(expected.name)) { manifest.missing.push(expected.uid); continue; }
    const entry = { name: expected.name, uid: expected.uid, containers: [] };
    manifest.pods.push(entry);
    for (const container of [...(pod.spec.initContainers || []), ...pod.spec.containers].map(c => c.name)) {
      for (const previous of [false, true]) streams.push({ entry, container, previous, ...k8s.openLog(expected.name, container, { previous, follow: !previous }) });
    }
  }
  // Every follow stream is open before any deletion is allowed.
  await Promise.all(streams.map(s => s.opened));
  onOpen();
  for (const s of streams) {
    const text = await s.text;
    // No previous instance is a normal case; a missing current log is a failure.
    if (text === null) { if (!s.previous) manifest.missing.push(`${s.entry.uid}/${s.container}`); continue; }
    const body = zlib.gzipSync(Buffer.from(text));
    const key = `${prefix}/${s.entry.name}/${s.container}${s.previous ? '.previous' : ''}.log.gz`;
    await s3.put(key, body);
    const back = await s3.get(key);
    if (!back || sha256(back) !== sha256(body)) throw Error(`sha256 mismatch on re-read: ${key}`);
    s.entry.containers.push({ container: s.container, previous: s.previous, key, sha256: sha256(body), bytes: body.length, ...stats(text) });
  }
  const body = Buffer.from(JSON.stringify(manifest));
  await s3.put(`${prefix}/manifest.json`, body);
  const back = await s3.get(`${prefix}/manifest.json`);
  if (!back || sha256(back) !== sha256(body)) throw Error('manifest sha256 mismatch on re-read');
  const complete = manifest.pods.filter(p => !manifest.missing.some(m => m.startsWith(p.uid)));
  const ok = manifest.missing.length === 0 && pods.every(p => complete.some(c => c.uid === p.uid));
  log(`LOGS ${ok ? 'OK' : 'INCOMPLETE'} pods=${complete.length}/${pods.length} missing=${manifest.missing.length}`);
  return { ok, podUids: complete.map(p => p.uid), logContainers: manifest.pods.reduce((n, p) => n + p.containers.length, 0),
    logBytes: manifest.pods.reduce((n, p) => n + p.containers.reduce((m, c) => m + c.bytes, 0), 0),
    manifestSha256: sha256(body) };
}
function inClusterK8s() {
  const dir = '/var/run/secrets/kubernetes.io/serviceaccount';
  const token = fs.readFileSync(`${dir}/token`, 'utf8');
  const ca = fs.readFileSync(`${dir}/ca.crt`);
  const namespace = fs.readFileSync(`${dir}/namespace`, 'utf8').trim();
  const base = `/api/v1/namespaces/${namespace}/pods`;
  const request = (path, onResponse) => https.get({ host: process.env.KUBERNETES_SERVICE_HOST, port: process.env.KUBERNETES_SERVICE_PORT,
    path, ca, headers: { Authorization: `Bearer ${token}` } }, onResponse);
  return {
    getPod: name => new Promise((resolve, reject) => {
      request(`${base}/${name}`, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(res.statusCode === 200 ? JSON.parse(Buffer.concat(chunks).toString()) : null));
      }).on('error', reject);
    }),
    openLog(name, container, { previous, follow }) {
      let opened, text;
      const openedP = new Promise(r => { opened = r; });
      const textP = new Promise((resolve, reject) => { text = { resolve, reject }; });
      const query = `container=${encodeURIComponent(container)}&timestamps=true${previous ? '&previous=true' : ''}${follow ? '&follow=true' : ''}`;
      request(`${base}/${name}/log?${query}`, res => {
        opened(true);
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode === 200) text.resolve(Buffer.concat(chunks).toString());
          else if (res.statusCode === 400 || res.statusCode === 404) text.resolve(null);
          else text.reject(Error(`log read failed: ${res.statusCode}`));
        });
      }).on('error', e => { opened(false); text.reject(e); });
      return { opened: openedP, text: textP };
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
  const ready = env.LOG_READY_FILE || '/tmp/streams-open';
  exportLogs({ pods, prefix: env.LOG_PREFIX, k8s: inClusterK8s(), s3: s3Client(env),
    onOpen: () => fs.writeFileSync(ready, 'open\n'), log: m => process.stderr.write(`${m}\n`) })
    .then(verdict => {
      if (env.TERMINATION_LOG) fs.writeFileSync(env.TERMINATION_LOG, JSON.stringify(verdict));
      else process.stdout.write(JSON.stringify(verdict));
      process.exitCode = verdict.ok ? 0 : 1;
    })
    .catch(e => { process.stderr.write(`logs_export_failed ${e.message}\n`); process.exitCode = 1; });
}
