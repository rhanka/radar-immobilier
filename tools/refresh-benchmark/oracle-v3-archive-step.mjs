// Archives the outputs of one step so that the step runs again from scratch, without deleting
// anything (owner decision 2026-09-18: converge-astra had voted on ~96 documents on the gold before
// astra-pass3; those votes must not be reused). annotations/<step> moves to
// annotations/<step>-<suffix>, file contents unchanged; archive-<step>-<suffix>.json lists every
// file with its sha256. An archived directory is never read by a step, the build or the scorer.
//
//   node tools/refresh-benchmark/oracle-v3-archive-step.mjs <step> <suffix> "<reason>" [--out <dir>]

import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ORACLE_V3_DIR, sha256, stepById } from "./oracle-v3-lib.mjs";

const exists = async (path) => { try { await stat(path); return true; } catch { return false; } };

export async function archiveStep({ outRoot, stepId, suffix, reason }) {
  stepById(stepId);
  if (!/^[a-z0-9-]+$/u.test(suffix)) throw new Error(`bad suffix ${suffix}`);
  const archived = `${stepId}-${suffix}`;
  const moves = [];
  for (const kind of ["annotations", "corrige"]) {
    const source = join(outRoot, kind, stepId);
    if (!await exists(source)) continue;
    if (await exists(join(outRoot, kind, archived))) throw new Error(`${kind}/${archived} already exists`);
    moves.push({ kind, source, target: join(outRoot, kind, archived) });
  }
  if (moves.length === 0) throw new Error(`nothing to archive for ${stepId}`);
  const files = [];
  for (const { kind, source } of moves) {
    for (const name of (await readdir(source)).sort()) {
      files.push({ path: `${kind}/${archived}/${name}`, sha256: sha256(await readFile(join(source, name))) });
    }
  }
  for (const { source, target } of moves) await rename(source, target);
  const log = { archivedAt: new Date().toISOString(), step: stepId, archivedAs: archived, reason,
    documents: files.filter(({ path }) => /^annotations\/.*\/[^_][^/]*(?<!\.receipt|\.error|\.parse-error)\.json$/u.test(path)).length,
    files };
  await writeFile(join(outRoot, `archive-${archived}.json`), `${JSON.stringify(log, null, 1)}\n`);
  return { archivedAs: archived, documents: log.documents, files: files.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stepId, suffix, reason, ...rest] = process.argv.slice(2);
  const index = rest.indexOf("--out");
  const outRoot = resolve(process.cwd(), index >= 0 ? rest[index + 1] : ORACLE_V3_DIR);
  if (!reason) throw new Error("usage: oracle-v3-archive-step.mjs <step> <suffix> <reason> [--out dir]");
  console.log(JSON.stringify(await archiveStep({ outRoot, stepId, suffix, reason })));
}
