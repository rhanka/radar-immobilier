// Install-script closure of the root lockfile (G0 v3 §4.1/§4.2, IG1 input).
// Lists every package the lockfile marks `hasInstallScript`, with the exact
// (package, version, integrity) triple a host postinstall allowlist entry
// would need. Pure Node, no dependency.
//
// CLI: node git-artifact-closure.mjs [package-lock.json]
import { readFileSync } from 'node:fs';

export function installScriptClosure(lock) {
  const entries = [];
  for (const [key, pkg] of Object.entries(lock.packages ?? {})) {
    if (!pkg.hasInstallScript || key === '') continue;
    const name = pkg.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    entries.push({
      package: name,
      version: pkg.version,
      integrity: pkg.integrity ?? null,
      location: key,
      dev: pkg.dev === true,
      optional: pkg.optional === true || pkg.devOptional === true,
    });
  }
  return entries.sort((a, b) => (a.location < b.location ? -1 : 1));
}

export function dependencyOrigins(lock) {
  const outside = [];
  for (const [key, pkg] of Object.entries(lock.packages ?? {})) {
    if (key === '' || pkg.link) continue;
    const resolved = pkg.resolved ?? '';
    if (resolved && !resolved.startsWith('https://registry.npmjs.org/')) outside.push({ location: key, resolved });
  }
  return outside;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lock = JSON.parse(readFileSync(process.argv[2] ?? 'package-lock.json', 'utf8'));
  const closure = installScriptClosure(lock);
  console.log(JSON.stringify({
    lockfileVersion: lock.lockfileVersion,
    packageCount: Object.keys(lock.packages ?? {}).length - 1,
    installScriptCount: closure.length,
    installScripts: closure,
    resolvedOutsideRegistry: dependencyOrigins(lock),
  }, null, 2));
}
