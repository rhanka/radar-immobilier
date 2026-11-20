// B′ pass state of Signal / DesignationEvent nodes, computed by the repository code
// (api/src/services/graph/graph-store.ts + vivier-v2.ts + @radar/domain) run with tsx inside a
// throw-away node:24 container (docker run --rm, read-only mounts, no network):
//   pass1 = z ∧ r ∧ p ∧ ¬hidden (Steve's 5 filters) · pass2 = z ∧ r ∧ ¬p ∧ ¬hidden · pass3 = rest.
// Rows come from a read-only SELECT (same columns as listCitiesWithSignalNodes).
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { REPO } from './paths.mjs';
import { lit, selectJson } from './db.mjs';

export const IMAGE = process.env.CLASSIF_NODE_IMAGE ?? 'node:24-bookworm-slim';
// Dependencies: docker volume filled by `make classif-deps` (npm ci, never on the host).
export const DEPS_VOLUME = process.env.CLASSIF_DEPS_VOLUME ?? 'radar-classif-deps-preprod';
const SRC_DIRS = ['api/src', 'packages/radar-domain/src', 'packages/radar-sources/src', 'packages/radar-scoring/src', 'packages/immo-mcp/src', 'tools/classif'];

const rowSql = (after, limit) => `select coalesce(jsonb_agg(t order by t.id), '[]'::jsonb) from (select id, city_slug as "citySlug", type,
  props->'properties'->>'category' as category, label, props->'properties'->>'description' as description,
  props->'properties'->>'etape' as "etapeAnnote", props, source_ref as "sourceRef"
  from graph_nodes where type in ('Signal','DesignationEvent') and city_slug is not null and id > ${lit(after)}
  order by id limit ${limit}) t`;

/** All Signal / DesignationEvent projection rows, keyset-paginated (read-only SELECTs). */
export function fetchProjectionRows({ page = 1500 } = {}) {
  const rows = [];
  let after = "";
  for (;;) {
    const chunk = selectJson(rowSql(after, page));
    rows.push(...chunk);
    if (chunk.length < page) return rows;
    after = chunk[chunk.length - 1].id;
  }
}

export function passOf([, z, r, p, hidden]) {
  if (z && r && !hidden) return p ? 'pass1' : 'pass2';
  return 'pass3';
}

/** Classifies rows; returns Map<id, { pass, z, r, p, hidden, instrument, etape }>. */
export function bprimeStates(rows) {
  const mounts = SRC_DIRS.flatMap((d) => ['-v', `${path.join(REPO, d)}:/w/${d}:ro`]);
  const args = ['run', '--rm', '-i', '--network', 'none', '-v', `${DEPS_VOLUME}:/w`, ...mounts,
    '-w', '/w', IMAGE, 'node', 'node_modules/tsx/dist/cli.mjs', 'tools/classif/l0/bprime-classify.ts'];
  const run = spawnSync('docker', args, { input: JSON.stringify(rows), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`bprime: classifier container failed: ${String(run.stderr).slice(-800)}`);
  const out = new Map();
  for (const row of JSON.parse(run.stdout)) {
    out.set(row[0], { pass: passOf(row), z: row[1], r: row[2], p: row[3], hidden: row[4], instrument: row[5], etape: row[6] });
  }
  return out;
}
