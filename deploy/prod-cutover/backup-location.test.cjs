/* global require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function probe(uri, endpoint = 'https://s3.bhs.io.cloud.ovh.net') {
  const env = { ENV: 'execution-prod', PGHOST: '127.0.0.1', PGPORT: '25432', PGDATABASE: 'radar',
    SOURCE_PGHOST: '127.0.0.1', SOURCE_PGPORT: '25432', SOURCE_PGUSER: 'radar_db_ro_prod',
    SOURCE_PGDATABASE: 'radar', SOURCE_PGPASSFILE: '/synthetic/readonly.pgpass',
    BACKUP_URI: uri, BACKUP_ENDPOINT: endpoint };
  const runtime = { fs, path, env, fail: code => { throw new Error(code); },
    destination() {}, mutationGuard() {}, approvedPlan: () => ({}), evidence: () => ({}),
    sql: () => 't', run() { throw new Error('unexpected_external_command'); } };
  const context = { module: { exports: {} }, require: () => runtime };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'backup.cjs'), 'utf8'), context);
  return () => context.module.exports.backup();
}
test('should accept the verified cutover destination before requiring an archive', () => {
  assert.throws(probe('s3://radar-immobilier-backup/v1220-cutover'), /absolute_archive_required/);
});
test('should reject any other destination before dumping or uploading', () => {
  for (const uri of ['s3://sentropic-pgbackup/immo/v1220/tonight',
    's3://radar-immobilier-backup/pg', 's3://radar-immobilier-backup/v1220-cutover/',
    's3://radar-immobilier-backup/v1220-cutover/../pg', ''])
    assert.throws(probe(uri), /backup_location_required/);
  assert.throws(probe('s3://radar-immobilier-backup/v1220-cutover', 'https://other.invalid'),
    /backup_location_required/);
});
