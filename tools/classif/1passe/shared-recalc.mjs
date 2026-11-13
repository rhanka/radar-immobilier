// Executor entry point. Score saved responses only; no source edits or subprocesses.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { sha256 } from '../lib/refc1.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url));
const lane = process.argv[2], half = process.argv[3] ?? 'tuning', check = process.argv.includes('--check');
assert(['recall', 'recall1099', 'csets'].includes(lane));
assert(['tuning', 'blind', '--check'].includes(half));
const root = path.resolve(dir, '../../../..', `classif-1passe-${lane}`);
const relative = lane === 'csets' ? 'tools/classif/csets' : `tools/classif/1passe/${lane}`;
const score = path.join(root, relative, 'score.mjs');
const matcher = path.join(dir, 'matching.mjs'), matcherURL = pathToFileURL(matcher).href;
const receipt = { lane, matcherSha256: sha256(fs.readFileSync(matcher)),
  adapterSha256: sha256(fs.readFileSync(import.meta.filename)), scorerSha256: sha256(fs.readFileSync(score)), llmCalls: 0 };
const csetsAdapter = `import { matchActs } from ${JSON.stringify(matcherURL)};
export function pairAct(input, text, acts) {
  const stage = input.match(/étape = ([^;\\n]+)/)?.[1]?.trim();
  const unit = { id: 'signal', page: 1, stage, citation: text, label: input };
  const groups = acts.map(node => ({ variants: (node.citations ?? []).map(c => {
    const p = node.properties ?? node;
    return { node, quote: c.excerpt, page: c.page, stage: stage ? (p.etape ?? p.stage ?? p.stade) : undefined,
      target_number: p.no_reglement ?? null };
  }) }));
  return matchActs([unit], groups, text).get('signal')?.node ?? null;
}`;
function replace(source, from, to) {
  assert(source.includes(from), `Unsupported scorer shape: ${from.slice(0, 80)}`);
  return source.replace(from, to);
}
function adapt(url, source) {
  if (lane === 'csets' && url === pathToFileURL(path.join(root, relative, 'matching.mjs')).href) return csetsAdapter;
  if (lane !== 'csets' && url === pathToFileURL(path.join(root, relative, 'metrics.mjs')).href) {
    const block = source.match(/export function pair\([^]*?\n\}/)?.[0];
    assert(block, 'Unsupported pair function');
    return replace(source, block, 'export function pair(units, groups, text) { return matchActs(units, groups, text); }');
  }
  if (url !== pathToFileURL(score).href) return source;
  if (lane !== 'csets') return source.replaceAll("fs.readFileSync('tools/classif/1passe/matching.mjs')", `fs.readFileSync(${JSON.stringify(matcher)})`);
  assert(source.includes("import {pairAct} from './matching.mjs';"), 'Unsupported csets scorer shape');
  return source;
}
adapt(pathToFileURL(score).href, fs.readFileSync(score, 'utf8'));
if (lane !== 'csets') {
  const metrics = path.join(root, relative, 'metrics.mjs');
  const adapted = adapt(pathToFileURL(metrics).href, fs.readFileSync(metrics, 'utf8'))
    .replaceAll("'../matching.mjs'", JSON.stringify(matcherURL));
  if (check) {
    const { pair } = await import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
    const q = 'Adoption du règlement 123-4 sur la densité résidentielle.';
    const unit = { id: 'b', citation: q, page: 1, stage: 'adoption' };
    const group = { variants: [{ quote: q, page: 1, stage: 'adoption' }] };
    assert.equal(pair([unit], [group], q).size, 1);
    assert.equal(pair([unit, { ...unit, id: 'c' }], [group], q).size, 0);
  }
}
if (check) {
  if (lane === 'csets') {
    const { pairAct } = await import(`data:text/javascript;base64,${Buffer.from(csetsAdapter).toString('base64')}`);
    const q = 'Adoption du règlement 123-4 sur la densité résidentielle.';
    const node = { id: 'a', citations: [{ page: 1, excerpt: q }], stage: 'adoption' };
    assert.equal(pairAct('étape = adoption', q, [node]), node);
    assert.equal(pairAct('étape = adoption', q, [node, { ...node, id: 'b' }]), null);
  }
  console.log(JSON.stringify({ ...receipt, status: 'adapter shapes verified; no blind opened' })); process.exit(0);
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
  childProcess[name] = () => { throw new Error('Subprocess refused: saved-output recalculation only'); };
syncBuiltinESMExports();
process.chdir(root);
if (lane === 'csets') {
  process.env.CLASSIF_HOME ??= path.join(os.homedir(), '.local/share/radar-classif/1passe-csets');
  if (half === 'blind') assert(process.env.CLASSIF_ROLE === 'test-executor' && process.env.CLASSIF_BLIND_KEY,
    'Csets blind requires the executor role and its existing key, injected by the custodian; no .env');
}
registerHooks({
  resolve(specifier, context, next) {
    if (lane !== 'csets' && (specifier.endsWith('/matching.mjs') || specifier === '../matching.mjs')) return { url: matcherURL, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith(pathToFileURL(path.join(root, relative)).href) || result.format !== 'module') return result;
    return { ...result, source: adapt(url, String(result.source)) };
  },
});
process.argv = [process.execPath, score, half];
const privateHome = lane === 'csets' ? process.env.CLASSIF_HOME : path.join(os.homedir(), `.local/share/radar-classif/1passe-${lane}`);
const previous = lane === 'csets' ? path.join(privateHome, `${half}-aggregates.json`) : path.join(root, relative, 'results.json');
fs.mkdirSync(privateHome, { recursive: true, mode: 0o700 });
if (fs.existsSync(previous)) fs.copyFileSync(previous, path.join(privateHome, `shared-recalc-before-${Date.now()}.json`));
await import(pathToFileURL(score).href);
fs.writeFileSync(path.join(privateHome, `shared-recalc-receipt-${lane === 'csets' ? half : 'both'}.json`),
  JSON.stringify({ ...receipt, at: new Date().toISOString() }), { mode: 0o600 });
console.log(JSON.stringify({ ...receipt, status: 'saved outputs recalculated', half: lane === 'csets' ? half : 'both' }));
