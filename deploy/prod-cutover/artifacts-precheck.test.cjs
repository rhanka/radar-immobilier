/* global require */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requiredSecrets, checkSecrets } = require('./artifacts-precheck.cjs');
const complete = name => Object.fromEntries([...requiredSecrets()[name]].map(key => [key, 88]));
test('precheck refuses every missing Secret or empty key before the window', () => {
  assert.equal(checkSecrets(complete).ok, true);
  for (const name of Object.keys(requiredSecrets())) {
    assert.throws(() => checkSecrets(n => n === name ? {} : complete(n)), /required_secret_missing/);
    for (const key of requiredSecrets()[name]) {
      assert.throws(() => checkSecrets(n => n === name ? { ...complete(n), [key]: 0 } : complete(n)), /required_secret_missing/);
    }
  }
});
