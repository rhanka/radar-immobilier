// Runs the artifact flavour of the ui build with an ALLOWLISTED build
// environment (G0 v3 §4.1, #1012 review F1). Usage, from the root script
// `build:artifact`:  node tools/make/ui-artifact-env.mjs npm run build -w ui
//
// - every inherited VITE_* variable is dropped, then exactly the artifact
//   variables below are set (Vite inlines VITE_* into the browser bundle);
// - GITHUB_PAGES and QA_HARNESS, read by ui/vite.config.ts, are dropped;
// - a ui/.env* file (loaded by Vite whatever the environment) refuses the build;
// - after the build, a dropped value found in ui/dist refuses the result.
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARTIFACT_ENV = Object.freeze({
  VITE_ARTIFACT_MODE: '1',
  VITE_API_BASE_URL: '/__app',
  VITE_BASEMAP_TILE_URL: '/__artifacts/tiles/v1/osm/{z}/{x}/{y}',
});
const DROPPED = Object.freeze(['GITHUB_PAGES', 'QA_HARNESS']);
const MIN_LEAK_LENGTH = 8;

export function artifactEnv(env) {
  const kept = {};
  const dropped = {};
  for (const [k, v] of Object.entries(env)) {
    // An inherited value equal to the allowlisted one is not a leak: the
    // bundle legitimately carries it (ui/vite.config.ts defaults the same
    // basemap URL for the live dev server, which runs without this wrapper).
    if (Object.hasOwn(ARTIFACT_ENV, k) && v === ARTIFACT_ENV[k]) continue;
    if (k.startsWith('VITE_') || DROPPED.includes(k)) dropped[k] = v;
    else kept[k] = v;
  }
  return { env: { ...kept, ...ARTIFACT_ENV }, dropped };
}

export function dotenvFiles(dir) {
  return readdirSync(dir).filter(n => n === '.env' || n.startsWith('.env.')).sort();
}

export function leaks(distDir, dropped) {
  const secrets = Object.entries(dropped).filter(([, v]) => typeof v === 'string' && v.length >= MIN_LEAK_LENGTH);
  const found = [];
  const walk = rel => {
    for (const name of readdirSync(join(distDir, rel))) {
      const path = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(join(distDir, path));
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        const bytes = readFileSync(join(distDir, path));
        for (const [k, v] of secrets) if (bytes.includes(v)) found.push({ file: path, variable: k });
      }
    }
  };
  if (secrets.length > 0) walk('');
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv.slice(2);
  if (command.length === 0) { console.error('usage: ui-artifact-env.mjs <command...>'); process.exit(2); }
  const stray = dotenvFiles('ui');
  if (stray.length > 0) {
    console.error(`[build:artifact] refused: ui/${stray.join(', ui/')} present (Vite would inline its VITE_* values)`);
    process.exit(1);
  }
  const { env, dropped } = artifactEnv(process.env);
  const names = Object.keys(dropped).sort();
  if (names.length > 0) console.log(`[build:artifact] not inherited: ${names.join(', ')}`);
  const run = spawnSync(command[0], command.slice(1), { env, stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
  const found = leaks('ui/dist', dropped);
  if (found.length > 0) {
    for (const f of found) console.error(`[build:artifact] refused: value of ${f.variable} found in ui/dist/${f.file}`);
    process.exit(1);
  }
}
