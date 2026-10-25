import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = 'packages/immo-mcp/src/account-binding.ts';
const original = readFileSync(file, 'utf8');
const listener = '  pool.on("error", logAccountDisconnect);';
assert.equal(original.split(listener).length, 2, 'pool error listener mutation site drift');
function run(label) {
  const build = spawnSync('npm', ['run', 'build', '--workspace=packages/immo-mcp'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const result = spawnSync(process.execPath, ['tools/make/artefacts-a4-image-probe.mjs'], {
    encoding: 'utf8', timeout: 30000,
  });
  writeFileSync(`/evidence/${label}.log`, result.stdout + result.stderr);
  copyFileSync('/evidence/mcp-runtime.log', `/evidence/${label}-runtime.log`);
  assert.equal(result.signal, null, `${label}: probe timeout or signal`);
  return result;
}
try {
  assert.equal(run('disconnect-before').status, 0);
  writeFileSync(file, original.replace(listener, ''));
  const mutant = run('disconnect-mutant');
  assert.notEqual(mutant.status, 0, 'missing pool listener mutant survived');
  assert.match(mutant.stderr, /MCP process died after PostgreSQL disconnect/);
  assert.match(readFileSync('/evidence/disconnect-mutant-runtime.log', 'utf8'), /Unhandled 'error' event/);
  console.log('KILLED missing pool listener: actual MCP process died after idle backend termination');
} finally { writeFileSync(file, original); }
assert.equal(run('disconnect-after').status, 0);
writeFileSync('/evidence/disconnect-mutation.json', JSON.stringify({
  killed: true, discriminant: 'actual child process exit after unhandled idle pool error',
  beforePassed: true, restoredPassed: true,
}));
console.log('PASS restored process: idle and active disconnect controls');
