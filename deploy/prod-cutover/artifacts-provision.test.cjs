/* global require, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
test('generated secrets retain existing keys and never print new key bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutover-secret-test-'));
  try {
    const state = path.join(dir, 'state'); fs.mkdirSync(state);
    // No cluster access. This stub records only key lengths and rejects other operations.
    fs.writeFileSync(path.join(dir, 'kubectl'), `#!/bin/bash
set -eu
while [[ $1 != config && $1 != get && $1 != create ]]; do shift; done
case $1 in
config) echo https://hlhedx.c1.bhs5.k8s.ovh.net ;;
get) [[ ! -f "$SECRET_TEST_STATE/$3" ]] || echo "secret/$3" ;;
create)
 name=$4; shift 4; test ! -e "$SECRET_TEST_STATE/$name"
 for arg; do
  [[ $arg == --from-file=* ]]
  key=$(printf '%s' "$arg" | cut -d= -f2); file=$(printf '%s' "$arg" | cut -d= -f3-)
  size=$(wc -c < "$file"); test "$size" = 64
  [[ $(tr -d 'a-f0-9' < "$file" | wc -c) = 0 ]]
  echo "$key:$size" >>"$SECRET_TEST_STATE/$name"
 done ;;
*) exit 9 ;;
esac
`, { mode: 0o700 });
    const invoke = env => spawnSync('make', ['--no-print-directory', '-f', 'deploy/prod-cutover/artifacts.mk', 'generated-secrets',
      'PROVISION_OWNER=k8s', `ENV=${env}`], { encoding: 'utf8', env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, SECRET_TEST_STATE: state } });
    assert.notEqual(invoke('prod').status, 0);
    assert.deepEqual(fs.readdirSync(state), []);
    const first = invoke('provision-prod');
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, '');
    const before = fs.readdirSync(state).map(name => [name, fs.readFileSync(path.join(state, name), 'utf8')]);
    assert.equal(before.length, 2);
    assert.equal(before.flatMap(([, text]) => text.trim().split('\n')).length, 3);
    const second = invoke('provision-prod');
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /[a-f0-9]{64}/);
    assert.deepEqual(fs.readdirSync(state).map(name => [name, fs.readFileSync(path.join(state, name), 'utf8')]), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
