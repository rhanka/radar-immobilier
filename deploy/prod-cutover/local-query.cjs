/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const r = require('./runtime.cjs');
function read(query) {
  if (r.env.ENV !== 'rehearsal' || r.env.PGHOST !== '127.0.0.1' || r.env.PGPORT !== '25433'
    || r.env.PGDATABASE !== 'radar_cutover_owner_20261113') r.fail('local_copy_read_only');
  return r.run('docker', ['exec', '-i',
    '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000',
    '-e', 'PGAPPNAME=radar-prod-copy-read', 'radar-prod-copy-owner-postgres-1',
    'psql', '-XqAt', '-U', 'radar', '-d', 'radar_cutover_owner_20261113',
    '-v', 'ON_ERROR_STOP=1', '--file=-'], { input: query, timeout: 20000 }).trim();
}
module.exports = { read };
