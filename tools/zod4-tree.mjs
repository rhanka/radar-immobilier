import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import process from 'node:process';
import { log } from 'node:console';

export function checkPackage(name, version, path) {
  assert(!['@sentropic/graphify', 'ollama-ai-provider'].includes(name), `${path}: forbidden ${name}`);
  if (name === '@ai-sdk/provider-utils') assert(!version.startsWith('2.'), `${path}: provider-utils 2.x`);
  if (name === 'zod') {
    const [major, minor, patch] = version.split('.').map(Number);
    assert(major > 4 || major === 4 && (minor > 6 || minor === 6 && patch >= 6), `${path}: vulnerable Zod ${version}`);
  }
}
export function checkTree(tree) {
  assert(!tree.problems?.length, JSON.stringify(tree.problems));
  const visit = (node) => {
    assert(!node.invalid && !node.extraneous && !node.missing, JSON.stringify(node));
    for (const child of Object.values(node.dependencies ?? {})) visit(child);
  };
  visit(tree);
}
export function inspectInstalled() {
  const zod = [];
  const visitModules = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith('@')) { visitModules(path); continue; }
      const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
      checkPackage(manifest.name, manifest.version, path);
      if (manifest.name === 'zod') zod.push({ path, version: manifest.version });
      try { if (statSync(join(path, 'node_modules')).isDirectory()) visitModules(join(path, 'node_modules')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
  for (const directory of ['node_modules', 'api', 'ui', 'packages/artifacts-host', 'packages/immo-mcp', 'packages/radar-domain', 'packages/radar-scoring', 'packages/radar-sources']) {
    visitModules(directory === 'node_modules' ? directory : join(directory, 'node_modules'));
  }
  assert(zod.length > 0, 'No installed Zod found');
  return zod;
}

if (process.argv[2]) {
  checkTree(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  for (const [path, data] of Object.entries(lock.packages)) {
    if (!path.includes('node_modules/')) continue;
    const name = path.split('node_modules/').at(-1);
    checkPackage(name, data.version, path);
  }
  for (const directory of ['api', 'packages/immo-mcp', 'packages/radar-domain', 'packages/radar-scoring', 'packages/radar-sources']) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies.zod, '^4.6.6', directory);
  }
  assert.equal(lock.packages['node_modules/@sentropic/engram'].version, '0.21.2');
  log(JSON.stringify({ installedZod: inspectInstalled(), treeProblems: 0, engram: '0.21.2' }, null, 2));
}
