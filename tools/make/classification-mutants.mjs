import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const evidence = '/evidence/mutations';
mkdirSync(evidence, { recursive: true });
const root = 'api/src/services/facets/';
const privacy = 'tests/integration/classification-privacy.spec.ts';
const cursor = 'src/services/facets/classification-cursor.test.ts';
const counts = 'src/services/facets/classification-counts.test.ts';
const cases = [
  { id: 'personal-filter', suite: privacy, test: 'isolate two readers', edits: [[`${root}scoped-reader.ts`,
    'eq(facetStreams.scope, "personal"), eq(facetStreams.ownerId, accountId),\n      eq(facetStreams.targetType',
    'eq(facetStreams.scope, "personal"),\n      eq(facetStreams.targetType']] },
  { id: 'common-archive', suite: privacy, test: 'isolate two readers', edits: [[`${root}classification-heads.ts`,
    '[nativeKey(row.target), row]', '[nativeKey(row.target), { ...row, workspace: null }]']] },
  { id: 'membership-union', suite: counts, test: 'eight-target oracle', edits: [[`${root}classification-counts.ts`,
    'const selected = visible.filter(({ facets }) => active(facets, "pertinent") || active(facets, "a_surveiller")).length;',
    'const selected = pertinent + watching;']] },
  { id: 'cursor-context', suite: cursor, test: 'bind purpose', edits: [[`${root}classification-continuation.ts`,
    'previous.contextDigest !== context', 'false']] },
  { id: 'cursor-signature', suite: cursor, test: 'altered signatures', edits: [[`${root}classification-cursor.ts`,
    '!timingSafeEqual(expected, actual)', 'false']] },
  { id: 'cursor-expiry-extension', suite: cursor, test: 'initial expiry', edits: [[`${root}classification-continuation.ts`,
    'issuedAt: previous?.issuedAt ?? now, expiresAt: previous?.expiresAt ?? now + 300',
    'issuedAt: now, expiresAt: now + 300']] },
  { id: 'final-authority', suite: 'tests/integration/classification-races.spec.ts', test: 'membership is revoked', edits: [
    [`${root}classification-projection.ts`,
      'const result = await readCoherentProjection(db, sub, workspaceId, citySlug, "signal", () => readPayload(before), 1);',
      'const scope = await readProjectionScope(db, sub, workspaceId, citySlug, "signal");\n      const result = { scope, payload: await readPayload(before) };'],
    [`${root}classification-projection.ts`, 'const after = catalogVersion(await readClassificationCatalog(db, sub, workspaceId));', 'const after = before;'],
    [`${root}classification-projection.ts`, 'const final = await readProjectionScope(db, sub, workspaceId, citySlug, "signal");', 'const final = result.scope;'],
  ] },
];
function run(entry, phase) {
  const report = `${evidence}/${entry.id}-${phase}.json`;
  const result = spawnSync('../node_modules/.bin/vitest', ['run', '--config', 'vitest.isolated.config.ts', entry.suite,
    '-t', entry.test, '--reporter=json', `--outputFile=${report}`], { cwd: 'api', encoding: 'utf8', timeout: 180000 });
  writeFileSync(`${evidence}/${entry.id}-${phase}.log`, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (result.error || result.signal) throw new Error(`${entry.id}: runner failure`);
  const data = JSON.parse(readFileSync(report, 'utf8'));
  const assertions = data.testResults.flatMap((suite) => suite.assertionResults).filter((test) => test.status !== 'pending' && test.status !== 'skipped');
  if (!assertions.length || !assertions.every((test) => test.fullName.includes(entry.test))) throw new Error(`${entry.id}: wrong collection`);
  if (phase === 'mutant') {
    if (result.status === 0 || !assertions.some((test) => test.status === 'failed' && test.failureMessages.some((message) => /AssertionError/.test(message)))) {
      throw new Error(`${entry.id}: no discriminating assertion failure`);
    }
  } else if (result.status !== 0 || !assertions.every((test) => test.status === 'passed')) throw new Error(`${entry.id}: restoration failed`);
  return { exit: result.status, executed: assertions.length, failed: assertions.filter((test) => test.status === 'failed').length };
}
const results = [];
for (const entry of cases) {
  const originals = new Map(entry.edits.map(([path]) => [path, readFileSync(path, 'utf8')]));
  try {
    for (const [path, from, to] of entry.edits) {
      const text = readFileSync(path, 'utf8');
      if (text.split(from).length !== 2) throw new Error(`${entry.id}: ambiguous edit`);
      writeFileSync(path, text.replace(from, to));
    }
    const edits = [...originals].map(([path, before]) => ({ path, before, after: readFileSync(path, 'utf8') }));
    writeFileSync(`${evidence}/${entry.id}-edit.json`, JSON.stringify(edits, null, 2));
    for (const [path, before] of originals) {
      const diff = spawnSync('diff', ['-u', '--label', `a/${path}`, '--label', `b/${path}`, '-', path], { input: before, encoding: 'utf8' });
      writeFileSync(`${evidence}/${entry.id}-${path.split('/').at(-1)}.diff`, diff.stdout);
      const changed = diff.stdout.split('\n').filter((line) => /^[+-](?![+-])/.test(line)).length;
      if (changed > 150) throw new Error('Mutation exceeds 150 lines');
    }
    const mutant = run(entry, 'mutant');
    for (const [path, before] of originals) writeFileSync(path, before);
    const restored = run(entry, 'restored');
    results.push({ id: entry.id, suite: entry.suite, test: entry.test, mutant, restored,
      originals: [...originals].map(([path, text]) => ({ path, sha256: createHash('sha256').update(text).digest('hex') })) });
    writeFileSync(`${evidence}/results.json`, JSON.stringify(results, null, 2));
    console.log(`KILLED and RESTORED ${entry.id}`);
  } finally { for (const [path, before] of originals) writeFileSync(path, before); }
}
