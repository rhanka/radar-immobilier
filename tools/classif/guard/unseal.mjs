#!/usr/bin/env node
// make classif-guard-unseal ENV=preprod — guardian act, run once by the conductor.
//
//  1. Unseals reference-c IN MEMORY with $REFERENCE_C_KEY (env only, never .env, never printed)
//     and checks each plaintext sha256 against docs/spec/reports/reference-c/README.md.
//  2. Parses Steve's Triage tab; partitions retained (121) and evaluation set (113).
//  3. Read-only SELECT of the referenced graph nodes; renders the frozen model inputs.
//  4. Seals the evaluation set with $CLASSIF_EVAL_KEY using the reference-c mechanism (REFC1,
//     encrypted content only, plaintext hashes in a README, byte-for-byte round trip), split into
//     inputs and expected labels, into docs/spec/reports/classif-eval/.
//  5. Writes label-free guard material to $CLASSIF_HOME/guard/ (mode 700/600): exclusions.json,
//     salt, fingerprints.json, codes-definitions.md.
//  6. Appends the access log; prints hashes and counts only. No plaintext file is ever written.
import process from 'node:process';
import { Buffer } from 'node:buffer';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { keyFromEnv, readmeHashes, sealToFile, sha256, unseal } from '../lib/refc1.mjs';
import { codebookFromMigration, codesMarkdown, nodeIdsIn, parseWorkbook, partition, shasIn, slugify } from '../lib/triage.mjs';
import { parseCsv } from '../lib/csv.mjs';
import { fetchNodes as dbFetchNodes } from '../lib/db.mjs';
import { nodeBylaws, nodeDocShas, renderItem } from '../lib/render.mjs';
import { baseCity, buildFingerprints } from '../lib/fingerprint.mjs';
import { EVAL_DIR_DEFAULT, GOLD_STEVE_30, MIGRATION_CODES, REFC_DIR, classifHome, writePrivate } from '../lib/paths.mjs';

export const EVAL_FILES = { inputs: 'eval-inputs.jsonl', expected: 'eval-expected.jsonl' };

const jsonl = (rows) => Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

/** Associates Reference C CSV rows with retained Triage rows (same order, city check). */
function csvIdsByLine(csvText, retained) {
  const rows = parseCsv(csvText);
  const body = rows.slice(1);
  const out = new Map();
  if (body.length !== retained.length) return { out, aligned: false, csvRows: body.length };
  for (let i = 0; i < body.length; i++) {
    const text = body[i].join('\n');
    if (!slugify(text).includes(retained[i].citySlug)) return { out: new Map(), aligned: false, csvRows: body.length };
    out.set(retained[i].lineNo, { nodeIds: nodeIdsIn(text), docShas: shasIn(text) });
  }
  return { out, aligned: true, csvRows: body.length };
}

function evalReadme({ files, counts, refcHashes, at }) {
  return `# Classification pilot evaluation set (sealed)

Steve's non-ambiguous rows (survey of 2026-09-21): Triage 124 rows, minus #14, #55, #58 (no
resolvable radar node) = 121 retained, minus the 8 rows not evaluated in the final pass of the gap
analysis (#18, #27, #77, #82, #93, #104, #112, #119) = **${counts.evaluation} rows**. Rows shaped
R′ and guides v2/v3, and the annotator families are evaluated families: every result on this set
carries the flag \`pilot-exposed\`. The repository is public, so the content is committed
**encrypted only**, with the mechanism of reference-c (PR #831/#843).

Sealed on ${at} from reference-c (xlsx plaintext \`${refcHashes.xlsx}\`, csv plaintext \`${refcHashes.csv}\`).

## Files

| Sealed file | Content | SHA-256 of plaintext |
|---|---|---|
| \`${EVAL_FILES.inputs}.sealed\` | One JSON line per row: evalId, line #, city slug, node ids, frozen model input (what the radar serves), input sha256 | \`${files.inputs.plainSha256}\` |
| \`${EVAL_FILES.expected}.sealed\` | One JSON line per row: evalId, line #, Steve verdict, Steve reason code, observed pass | \`${files.expected.plainSha256}\` |

Counts: ${counts.evaluation} rows, ${counts.withInput} with a rendered input, ${counts.withoutInput} without any node found
in the graph (kept, input null, scored as \`execution-failure\` or excluded per Annex M).

## Key

- Variable \`CLASSIF_EVAL_KEY\` (base64, 32 bytes), generated and held by the conductor, stored in the
  repo-root \`.env\` (git-ignored) and injected at launch. Agents never read \`.env\`.
- Without the key the files are unreadable. Only the test executor role opens them
  (\`tools/classif/guard/evalset.mjs\`: role, key, plaintext sha256, one run per prompt/model/effort, access log).

## Format and checks

\`REFC1\` | IV (12 bytes) | GCM tag (16 bytes) | AES-256-GCM ciphertext. Each sealed file was read back,
unsealed and compared byte for byte with its plaintext before this README was written. No plaintext
is kept on disk. Access log: \`access-log.jsonl\` (append-only).
`;
}

export async function run({
  env = process.env,
  refcDir = REFC_DIR,
  evalDir = EVAL_DIR_DEFAULT,
  home = classifHome(env),
  fetchNodes = dbFetchNodes,
  goldFile = GOLD_STEVE_30,
  migrationFile = MIGRATION_CODES,
  log = (s) => process.stdout.write(`${s}\n`),
  now = () => new Date().toISOString(),
} = {}) {
  // Preconditions first: nothing is written before every check passes.
  const refKey = keyFromEnv('REFERENCE_C_KEY', env);
  const evalKey = keyFromEnv('CLASSIF_EVAL_KEY', env);
  if (refKey.equals(evalKey)) throw new Error('CLASSIF_EVAL_KEY must differ from REFERENCE_C_KEY');
  const guardDir = path.join(home, 'guard');
  const targets = [path.join(evalDir, `${EVAL_FILES.inputs}.sealed`), path.join(evalDir, `${EVAL_FILES.expected}.sealed`), path.join(evalDir, 'README.md'),
    ...['exclusions.json', 'salt', 'fingerprints.json', 'codes-definitions.md'].map((f) => path.join(guardDir, f))];
  const existing = targets.filter((t) => existsSync(t));
  if (existing.length) throw new Error(`refusing to overwrite existing outputs: ${existing.join(', ')}`);

  // 1. Unseal reference-c in memory and check hashes.
  const expected = readmeHashes(readFileSync(path.join(refcDir, 'README.md'), 'utf8'));
  const open = (name) => {
    const plain = unseal(refKey, readFileSync(path.join(refcDir, `${name}.sealed`)));
    const want = expected.get(`${name}.sealed`);
    if (!want || sha256(plain) !== want) throw new Error(`${name}: plaintext sha256 differs from reference-c/README.md`);
    return plain;
  };
  const xlsx = open('reference-c.xlsx');
  const csv = open('reference-c.csv');

  // 2. Workbook, partitions, codebook.
  const wb = parseWorkbook(xlsx);
  const { retained, evaluation } = partition(wb.rows);
  const migration = codebookFromMigration(readFileSync(migrationFile, 'utf8'));
  const wbCodes = new Set(wb.codes.map((c) => c.code));
  const missing = migration.filter((c) => !wbCodes.has(c.code)).map((c) => c.code);
  if (wb.codes.length !== 28 || migration.length !== 28 || missing.length) {
    throw new Error(`codebook mismatch: workbook ${wb.codes.length}, migration ${migration.length}, missing in workbook: ${missing.join(',')}`);
  }
  const csvMap = csvIdsByLine(csv.toString('utf8'), retained);

  // 3. Nodes referenced anywhere (workbook tabs + Reference C), read-only.
  const rowIds = (r) => [...new Set([...r.nodeIds, ...(csvMap.out.get(r.lineNo)?.nodeIds ?? [])])];
  const allIds = [...new Set([...wb.workbookNodeIds, ...nodeIdsIn(csv.toString('utf8')), ...wb.rows.flatMap(rowIds)])].filter((i) => /^[A-Za-z0-9._:-]+$/.test(i)).sort();
  const nodes = await fetchNodes(allIds);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 4. Evaluation set: inputs and expected labels in two files.
  const inputs = [];
  const labels = [];
  for (const r of evaluation) {
    const ids = rowIds(r).filter((i) => byId.has(i) && ['Signal', 'DesignationEvent'].includes(byId.get(i).type));
    const found = ids.map((i) => byId.get(i));
    const citySlug = found[0]?.city_slug ?? r.citySlug;
    const input = found.length ? renderItem(citySlug, found) : null;
    const evalId = `eval-${String(r.lineNo).padStart(3, '0')}`;
    inputs.push({ evalId, lineNo: r.lineNo, citySlug, nodeIds: ids, missingNodeIds: rowIds(r).filter((i) => !byId.has(i)), input, inputSha256: input ? sha256(input) : null });
    labels.push({ evalId, lineNo: r.lineNo, verdict: r.verdict, code: r.code, pass: r.pass, flag: 'pilot-exposed' });
  }

  // 5. Label-free exclusions (every Triage row, retained or not, is exposed).
  let gold = [];
  try {
    gold = Object.keys(JSON.parse(readFileSync(goldFile, 'utf8'))).filter((k) => !k.startsWith('_'));
  } catch { gold = []; }
  const exposedNodes = allIds.map((i) => byId.get(i)).filter(Boolean);
  const exclusions = {
    version: 1,
    createdAt: now(),
    note: 'Label-free exclusion lists derived from reference-c (Steve survey) and Gold Steve 30. No verdict, no code.',
    citySlugs: [...new Set([...wb.rows.map((r) => r.citySlug), ...exposedNodes.map((n) => baseCity(n.city_slug)), ...gold.map(baseCity)])].filter(Boolean).sort(),
    dbCitySlugs: [...new Set(exposedNodes.map((n) => n.city_slug))].sort(),
    nodeIds: allIds,
    docShas: [...new Set([...wb.workbookShas, ...shasIn(csv.toString('utf8')), ...exposedNodes.flatMap(nodeDocShas)])].sort(),
    bylaws: [...new Set([...wb.rows.flatMap((r) => r.bylaws), ...exposedNodes.flatMap(nodeBylaws)])].sort(),
    sources: {
      triageRows: wb.rows.length, retained: retained.length, evaluation: evaluation.length,
      surveyCities: new Set(wb.rows.map((r) => r.citySlug)).size, goldSteve30Cities: gold.length,
      referenceCsvAligned: csvMap.aligned, nodesRequested: allIds.length, nodesFound: nodes.length,
      julyNotebookCities: 'source-gap (location unverified, plan §G)',
    },
  };
  const salt = randomBytes(32).toString('hex');
  const fingerprints = buildFingerprints(salt, {
    nodeIds: exclusions.nodeIds, docShas: exclusions.docShas, citySlugs: exclusions.citySlugs, bylaws: exclusions.bylaws,
    inputs: inputs.map((i) => i.input).filter(Boolean),
  });

  // 6. Write: sealed files (round trip verified), README, guard material. Roll back on failure.
  const created = [];
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(evalDir, { recursive: true });
    const files = {};
    for (const [k, rows] of [['inputs', inputs], ['expected', labels]]) {
      const target = path.join(evalDir, `${EVAL_FILES[k]}.sealed`);
      files[k] = sealToFile(evalKey, jsonl(rows), target);
      created.push(target);
    }
    const at = now();
    const counts = { evaluation: evaluation.length, withInput: inputs.filter((i) => i.input).length, withoutInput: inputs.filter((i) => !i.input).length };
    const readme = path.join(evalDir, 'README.md');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(readme, evalReadme({ files, counts, refcHashes: { xlsx: sha256(xlsx), csv: sha256(csv) }, at }), { flag: 'wx' });
    created.push(readme);
    const exclusionsBuf = Buffer.from(`${JSON.stringify(exclusions, null, 1)}\n`);
    const fingerprintsBuf = Buffer.from(`${JSON.stringify(fingerprints)}\n`);
    const codesBuf = Buffer.from(codesMarkdown(wb.codes));
    for (const [name, data] of [['exclusions.json', exclusionsBuf], ['salt', `${salt}\n`], ['fingerprints.json', fingerprintsBuf], ['codes-definitions.md', codesBuf]]) {
      const f = path.join(guardDir, name);
      writePrivate(f, data);
      created.push(f);
    }
    const entry = {
      at, actor: env.CLASSIF_ACTOR ?? os.userInfo().username, role: 'guardian', action: 'unseal-reference-c+seal-eval-set',
      referenceC: { xlsx: sha256(xlsx), csv: sha256(csv) },
      evalSet: { inputs: files.inputs.plainSha256, expected: files.expected.plainSha256, rows: evaluation.length },
      exclusionsSha256: sha256(exclusionsBuf), fingerprintsSha256: sha256(fingerprintsBuf),
    };
    appendFileSync(path.join(evalDir, 'access-log.jsonl'), `${JSON.stringify(entry)}\n`);
    const summary = {
      referenceC: { 'reference-c.xlsx': `${sha256(xlsx)} (README match)`, 'reference-c.csv': `${sha256(csv)} (README match)` },
      evalSet: {
        rows: evaluation.length, withInput: counts.withInput, withoutInput: counts.withoutInput, triageNumbering: wb.numberingSource,
        [`${EVAL_FILES.inputs}.sealed`]: { plainSha256: files.inputs.plainSha256, sealedSha256: files.inputs.sealedSha256, roundTrip: 'byte-for-byte OK' },
        [`${EVAL_FILES.expected}.sealed`]: { plainSha256: files.expected.plainSha256, sealedSha256: files.expected.sealedSha256, roundTrip: 'byte-for-byte OK' },
      },
      guard: {
        dir: guardDir,
        'exclusions.json': sha256(exclusionsBuf), 'fingerprints.json': sha256(fingerprintsBuf), 'codes-definitions.md': sha256(codesBuf),
        cities: exclusions.citySlugs.length, nodeIds: exclusions.nodeIds.length, nodesFound: nodes.length,
        docShas: exclusions.docShas.length, bylaws: exclusions.bylaws.length, referenceCsvAligned: csvMap.aligned,
      },
      plaintextOnDisk: 'none',
    };
    log(JSON.stringify(summary, null, 2));
    return summary;
  } catch (err) {
    for (const f of created) rmSync(f, { force: true });
    throw err;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run().catch((err) => {
    process.stderr.write(`classif-guard-unseal: ${err.message}\n`);
    process.exit(1);
  });
}
