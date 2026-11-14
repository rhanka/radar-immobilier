/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const r = require('./runtime.cjs');
const { checkCors, precheck } = require('./cors-precheck.cjs');
const expected = () => r.json(r.path.join(__dirname, 'artifacts-cors.json'));
test('CORS gate refuses absence, foreign origins, missing PUT and unsafe headers', () => {
  assert.equal(checkCors(expected()).ok, true);
  for (const invalid of [undefined, {}, { CORSRules: [] }]) assert.throws(() => checkCors(invalid), /bucket_cors/);
  for (const [key, value] of [['AllowedOrigins', ['*']], ['AllowedMethods', ['GET', 'HEAD']],
    ['AllowedHeaders', ['*']], ['ExposeHeaders', []], ['MaxAgeSeconds', 0]]) {
    const invalid = expected(); invalid.CORSRules[0][key] = value;
    assert.throws(() => checkCors(invalid), /bucket_cors/);
  }
});
test('CORS uses GetBucketCors on the explicit cluster and fails closed on denied reads', () => {
  const original = r.run;
  const secret = { data: { ARTIFACTS_S3_ACCESS_KEY: 'c3ludGhldGlj', ARTIFACTS_S3_SECRET_KEY: 'c3ludGhldGlj' } };
  let denied = false;
  r.run = (bin, args, options) => {
    assert.equal(bin, 'kubectl'); assert.ok(args.includes('--kubeconfig'));
    if (args.includes('config')) return 'https://hlhedx.c1.bhs5.k8s.ovh.net';
    if (args.includes('get')) return JSON.stringify(secret);
    assert.ok(args.includes('exec')); assert.ok(args.includes('deployment/radar-api'));
    assert.match(options.input, /GetBucketCorsCommand/); assert.doesNotMatch(options.input, /PutBucketCors/);
    assert.ok(!args.some(arg => arg.includes('synthetic')));
    if (denied) throw Error('AccessDenied');
    return JSON.stringify(expected());
  };
  try { assert.equal(precheck().ok, true); denied = true; assert.throws(() => precheck(), /AccessDenied/); }
  finally { r.run = original; }
});
