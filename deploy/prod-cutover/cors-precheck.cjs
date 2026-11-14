/* global require, module, process, Buffer, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
function checkCors(configuration) {
  const rules = configuration?.CORSRules;
  const equal = (a, b) => Array.isArray(a) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const expected = r.json(r.path.join(__dirname, 'artifacts-cors.json')).CORSRules;
  if (!Array.isArray(rules) || rules.length !== expected.length || rules.some((rule, i) =>
    ['AllowedOrigins', 'AllowedMethods', 'AllowedHeaders', 'ExposeHeaders'].some(key => !equal(rule[key], expected[i][key]))
    || rule.MaxAgeSeconds !== expected[i].MaxAgeSeconds)) r.fail('bucket_cors_missing_or_divergent');
  return { ok: true, operation: 'GetBucketCors', valuesPrinted: false };
}
function precheck() {
  const kube = ['--kubeconfig', r.path.join(r.env.HOME, '.kube/radar-prod-tenant-admin.kubeconfig'),
    '--request-timeout=15s', '-n', 'radar-immobilier'];
  if (r.run('kubectl', [...kube, 'config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}']).trim()
    !== 'https://hlhedx.c1.bhs5.k8s.ovh.net') r.fail('cluster_mismatch');
  const secret = JSON.parse(r.run('kubectl', [...kube, 'get', 'secret', 'radar-artifacts-prod', '-o', 'json']));
  const read = key => {
    const value = Buffer.from(secret.data?.[key] || '', 'base64').toString('utf8');
    if (!value) r.fail('bucket_cors_credentials_missing');
    return value;
  };
  const config = { endpoint: 'https://s3.bhs.io.cloud.ovh.net', region: 'bhs', forcePathStyle: true,
    credentials: { accessKeyId: read('ARTIFACTS_S3_ACCESS_KEY'), secretAccessKey: read('ARTIFACTS_S3_SECRET_KEY') },
    maxAttempts: 1 };
  // Existing API pod only. Credentials travel on stdin and never enter argv or logs.
  const input = `const {S3Client,GetBucketCorsCommand}=require('@aws-sdk/client-s3');
    new S3Client(${JSON.stringify(config)}).send(new GetBucketCorsCommand({Bucket:'radar-immobilier-artifacts'}),
    {abortSignal:AbortSignal.timeout(15000)}).then(x=>console.log(JSON.stringify({CORSRules:x.CORSRules})))
    .catch(()=>process.exit(1));`;
  return checkCors(JSON.parse(r.run('kubectl', [...kube, 'exec', '-i', 'deployment/radar-api', '--', 'node', '-'], { input })));
}
// Behavioural fallback: the prefix-limited key cannot GetBucketCors (CORS is set by the k8s
// bucket owner). An unauthenticated preflight proves the effective rule without credentials.
function preflight(origin) {
  const url = 'https://s3.bhs.io.cloud.ovh.net/radar-immobilier-artifacts/artifacts/radar-immobilier/cors-probe';
  const out = r.run('curl', ['-s', '-o', '/dev/null', '-D', '-', '--max-time', '15', '-X', 'OPTIONS', url,
    '-H', `Origin: ${origin}`, '-H', 'Access-Control-Request-Method: PUT',
    '-H', 'Access-Control-Request-Headers: content-type']);
  const status = Number((/^HTTP\/[\d.]+ (\d{3})/m.exec(out) || [])[1]);
  const acao = ((/^access-control-allow-origin:\s*(\S+)/im.exec(out)) || [])[1] || null;
  return { status, acao };
}
function preflightPrecheck() {
  const allowed = r.json(r.path.join(__dirname, 'artifacts-cors.json')).CORSRules[0].AllowedOrigins;
  for (const origin of allowed) {
    const res = preflight(origin);
    if (res.status !== 200 || res.acao !== origin) r.fail('bucket_cors_preflight_refused');
  }
  const foreign = preflight('https://cors-probe.invalid');
  if (foreign.acao) r.fail('bucket_cors_preflight_too_open');
  return { ok: true, operation: 'preflight', origins: allowed.length, valuesPrinted: false };
}
if (require.main === module) {
  let result;
  try { result = precheck(); }
  catch { try { result = preflightPrecheck(); } catch { result = null; } }
  if (result) process.stdout.write(JSON.stringify(result) + '\n');
  else { process.stderr.write('bucket_cors_missing_unreadable_or_divergent\n'); process.exitCode = 1; }
}
module.exports = { checkCors, precheck, preflightPrecheck };
