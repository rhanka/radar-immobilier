import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { makeCiSecrets } from '../ci/bascule-preprod/ci-secrets.mjs';
const config = JSON.parse(readFileSync('deploy/cutover/config.json', 'utf8'));
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.ENV !== 'preprod') process.exit(1);
const log = () => {};
const die = () => { throw new Error('Installed backup Secret synchronization failed'); };
const commands = makeCiSecrets({ log, section: log, die,
  jobDefaults: () => ({ NAMESPACE: config.preprod.namespace }),
  run: (command, args) => spawnSync(command, ['--request-timeout=15s', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) });
try { commands.commands['backup-secrets-fill'](); }
catch { process.stderr.write('Backup Secret synchronization failed (values suppressed)\n'); process.exitCode = 1; }
