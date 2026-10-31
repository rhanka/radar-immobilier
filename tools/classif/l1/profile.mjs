#!/usr/bin/env node
// make classif-l1-profile ENV=preprod — L1 (plan §B-L1):
//  1. SELECT export of facet_reason_codes (profile immo-steve-2026-09) to
//     radar/ontology/steve-classification/registries/reason_codes.csv, checked against the
//     migration seed with the compareCodebook logic (api/src/services/facets/codebook.ts).
//  2. Engram 0.21.2 unchanged: profile validate → dataprep (over the 504 dev items written as
//     corpus/<itemId>.md in a private workspace) → profile-prompt. Prints hashes and counts.
import path from 'node:path';
import process from 'node:process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { selectJson } from '../lib/db.mjs';
import { toCsv } from '../lib/csv.mjs';
import { codebookFromMigration } from '../lib/triage.mjs';
import { sha256 } from '../lib/render.mjs';
import { MIGRATION_CODES, classifHome } from '../lib/paths.mjs';
import { PROFILE_DIR, buildProfileState, engramVersion, prepareWorkspace } from '../lib/engram.mjs';

export const PROFILE_ID = 'immo-steve-2026-09';

export function compareCodebook(expected, actual) {
  const key = (r) => JSON.stringify([r.code, r.verdict]);
  const left = new Set(expected.map(key));
  const right = new Set(actual.map(key));
  const missing = [...left].filter((e) => !right.has(e)).sort();
  const unexpected = [...right].filter((e) => !left.has(e)).sort();
  const duplicates = [expected, actual].map((rows) => rows.length - new Set(rows.map(key)).size);
  return { equal: !missing.length && !unexpected.length && duplicates.every((n) => n === 0), missing, unexpected, duplicates };
}

export const itemFile = (item) => `${item.itemId}.md`;
export const itemMarkdown = (item) => `# ${item.itemId}\n\n${item.input}\n`;

export function writeCorpus(work, items) {
  for (const it of items) writeFileSync(path.join(work, 'corpus', itemFile(it)), itemMarkdown(it), { mode: 0o600 });
}

export async function main() {
  const db = selectJson(`select coalesce(jsonb_agg(t order by t.code), '[]'::jsonb) from (select code, verdict from facet_reason_codes where profile_id = '${PROFILE_ID}') t`);
  const seed = codebookFromMigration(readFileSync(MIGRATION_CODES, 'utf8'));
  const cmp = compareCodebook(seed, db);
  if (!cmp.equal || db.length !== 28) throw new Error(`facet_reason_codes differs from the migration seed: ${JSON.stringify(cmp)}`);
  const csv = toCsv([['code', 'verdict'], ...db.map((r) => [r.code, r.verdict])]);
  const csvFile = path.join(PROFILE_DIR, 'registries', 'reason_codes.csv');
  writeFileSync(csvFile, csv);

  const home = classifHome();
  const devFile = path.join(home, 'l0', 'dev-items.jsonl');
  if (!existsSync(devFile)) throw new Error(`${devFile} missing (lot L0)`);
  const items = readFileSync(devFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const work = prepareWorkspace(path.join(home, 'l1', 'engram-work'));
  writeCorpus(work, items);
  const built = buildProfileState(work);
  const state = JSON.parse(readFileSync(built.state, 'utf8'));
  const summary = {
    engram: engramVersion(work), profile: { id: state.profile?.id, version: state.profile?.version, hash: state.profile?.profile_hash },
    codebook: { rows: db.length, equalToMigration: cmp.equal, csvSha256: sha256(csv) },
    registries: Object.fromEntries(Object.entries(state.registries ?? {}).map(([k, v]) => [k, v.length])),
    corpus: items.length, profilePromptSha256: sha256(built.prompt), workspace: work,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('l1', 'profile.mjs'))) {
  main().catch((err) => { process.stderr.write(`classif-l1-profile: ${err.message}\n`); process.exit(1); });
}
