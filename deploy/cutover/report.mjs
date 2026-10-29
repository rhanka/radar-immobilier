import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { validateListing, formatBackupTable } from '../ci/bascule-preprod/backup-utils.mjs';
import { assembleRefs } from '../ci/bascule-preprod/e2e-refs.mjs';
const [action, output, input] = process.argv.slice(2);
mkdirSync(output, { recursive: true });
if (action === 'list') {
  const listing = validateListing(JSON.parse(readFileSync(input, 'utf8')));
  writeFileSync(join(output, 'backup-list.json'), `${JSON.stringify(listing)}\n`);
  process.stdout.write(`${formatBackupTable(listing).text}\n`);
} else if (action === 'refs') {
  const config = JSON.parse(readFileSync('deploy/cutover/config.json', 'utf8'));
  const cms = [];
  for (let i = 0; i < 4; i++) {
    const result = spawnSync('kubectl', ['--request-timeout=15s', '-n', config.preprod.namespace,
      'get', 'configmap', `immo-served-refs-${i}`, '-o', 'json'], { encoding: 'utf8' });
    if (result.status !== 0) { if (!i) throw new Error('Served references unavailable'); break; }
    cms.push(JSON.parse(result.stdout));
  }
  const refs = assembleRefs(cms, { cycleId: process.env.CYCLE_ID });
  writeFileSync(join(output, 'immo-served-refs.tsv.gz'), refs.gz);
  writeFileSync(join(output, 'meta.json'), `${JSON.stringify(refs.meta)}\n`);
} else throw new Error('Unknown report action');
