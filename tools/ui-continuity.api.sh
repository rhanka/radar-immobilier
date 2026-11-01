#!/bin/sh
# stdin is git archive HEAD: no untracked files or environment files are copied.
set -eu
npm ci --no-audit --no-fund
snapshot=/tmp/continuity-source
mkdir -p "$snapshot"
tar -xf - -C "$snapshot"
# Keep locked dependencies in their isolated volumes, with workspace links
# pointing at the snapshot. Subprocess TSX imports then avoid host bind I/O.
CONTINUITY_SNAPSHOT="$snapshot" node --input-type=module <<'JS'
import { readdirSync, mkdirSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const source = '/workspace';
const snapshot = process.env.CONTINUITY_SNAPSHOT;
const modules = join(snapshot, 'node_modules');
mkdirSync(modules, { recursive: true });
function link(from, to) {
  const real = realpathSync(from);
  const workspace = real.startsWith(source + '/') && !real.startsWith(source + '/node_modules/');
  symlinkSync(workspace ? snapshot + real.slice(source.length) : real, to);
}
for (const entry of readdirSync(join(source, 'node_modules'))) {
  if (entry.startsWith('@')) {
    mkdirSync(join(modules, entry));
    for (const name of readdirSync(join(source, 'node_modules', entry))) {
      link(join(source, 'node_modules', entry, name), join(modules, entry, name));
    }
  } else link(join(source, 'node_modules', entry), join(modules, entry));
}
for (const path of ['api', 'ui', ...readdirSync(join(source, 'packages')).map(name => 'packages/' + name)]) {
  if (existsSync(join(source, path, 'node_modules')) && existsSync(join(snapshot, path))) {
    symlinkSync(join(source, path, 'node_modules'), join(snapshot, path, 'node_modules'));
  }
}
JS
cd "$snapshot"
npm run db:migrate --workspace=api
exec npm run test --workspace=api -- "$@"
