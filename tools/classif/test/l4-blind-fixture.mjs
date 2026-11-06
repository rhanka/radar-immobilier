// Shared hermetic fixture for the L4 blind executor tests (infra re-run, recall
// non-regression). Seats are faked by PATH binaries: the vibe routes fail with exit 2
// (HTTP 402 budget exhausted) unless the item id is listed in FAKE_GLM / FAKE_MISTRAL
// ("ok" = every item answers); claude answers non_pertinent on the ids listed in
// FAKE_CLAUDE_NP, pertinent elsewhere. Temp CLASSIF_HOME (caller's withTempHome), temp
// repo via CLASSIF_REPO, temp eval dir. Synthetic items only.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCodes } from '../l2/run.mjs';
import { EVAL_ROUTES } from '../l4/dev.mjs';
import { commitAll, initTempRepo, readFixture, swapEnv, tmp, writeRepoFile, writeSeriesRepo } from './hermetic-helpers.mjs';

const NON_PERTINENT = [...loadCodes()].find(([, v]) => v === 'non_pertinent')[0];

export const blindIds = (n) => Array.from({ length: n }, (_, i) => `b-${String(i + 1).padStart(3, '0')}`);

export function fakeSeats() {
  const bin = tmp('l4blind-bin-');
  const script = `#!/bin/sh
name=$(basename "$0")
pf=""; prev=""
for a in "$@"; do [ "$prev" = "--prompt-file" ] && pf="$a"; prev="$a"; done
if [ -n "$pf" ]; then body=$(cat "$pf"); else body=$(cat); fi
id=$(printf '%s' "$body" | grep -o 'item_id: [A-Za-z0-9._-]*' | head -1 | cut -d' ' -f2)
mode=ok
case "$VIBE_ACTIVE_MODEL" in *glm*) mode="\${FAKE_GLM:-ok}" ;; *mistral*) mode="\${FAKE_MISTRAL:-ok}" ;; esac
if [ "$mode" != ok ]; then
  case " $mode " in *" $id "*) ;; *) echo "HTTP 402 budget exhausted" >&2; exit 2 ;; esac
fi
verdict=pertinent; code=P-DENSITE
if [ "$name" = claude ]; then case " $FAKE_CLAUDE_NP " in *" $id "*) verdict=non_pertinent; code=${NON_PERTINENT} ;; esac; fi
esc=$(printf '{"verdict":"%s","code":"%s"}' "$verdict" "$code" | sed 's/"/\\\\"/g')
case "$name" in
  claude) printf '{"result":"%s","total_cost_usd":0.01,"usage":{"input_tokens":3}}' "$esc" ;;
  vibe) printf '[{"role":"assistant","type":"message","content":[{"type":"text","text":"%s"}]}]' "$esc" ;;
  muse) printf '{"terminal":"completed","text":"%s"}\\n' "$esc" ;;
  agy) printf '{"event":"result","result":{"response":"%s"}}\\n' "$esc" ;;
esac
exit 0
`;
  for (const name of ['muse', 'claude', 'vibe', 'agy']) {
    const f = path.join(bin, name);
    writeFileSync(f, script, { mode: 0o755 });
    chmodSync(f, 0o755);
  }
  const restore = swapEnv('PATH', `${bin}:${process.env.PATH}`);
  return () => { restore(); rmSync(bin, { recursive: true, force: true }); };
}

/**
 * Blind home + temp series repo for series k over `routes` (every blind ref pertinent,
 * resolved). `seriesExtra` is merged into the pre-registered series manifest (for example
 * recallNonRegression). Returns { repo, cleanup }.
 */
export async function setupBlind(home, { k, routes, ids, seriesExtra = null, floors, supports = { recall: 30, precision: 30 } }) {
  const { sha256 } = await import('../lib/render.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const { newKey } = await import('./fixture.mjs');
  const { sealToFile } = await import('../lib/refc1.mjs');
  const { sealBlindSet } = await import('../lib/blind.mjs');
  const blindRows = ids.map((id) => ({ itemId: id, kind: 'signal', code: 'P-DENSITE', verdict: 'pertinent', status: 'resolved' }));
  const corpus = ids.map((id) => ({ itemId: id, kind: 'signal', anchor: { id: `n-${id}`, citySlug: 'v' }, input: `texte blind ${id} six logements zone H-9.` }));
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const cbody = `${corpus.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), cbody);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: corpus.length, sha256: sha256(cbody) }));
  mkdirSync(path.join(home, 'guard'), { recursive: true });
  writeFileSync(path.join(home, 'guard', 'salt'), 'rr-salt\n');
  writeFileSync(path.join(home, 'guard', 'fingerprints.json'), JSON.stringify(buildFingerprints('rr-salt', { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['scelle fictif blind'] })));
  const evalKey = newKey();
  const restores = [swapEnv('CLASSIF_ROLE', 'test-executor'), swapEnv('CLASSIF_ACTOR', 'l4blind-test'),
    swapEnv('CLASSIF_BLIND_KEY', newKey().toString('base64')), swapEnv('CLASSIF_EVAL_KEY', evalKey.toString('base64'))];
  const seal = sealBlindSet(blindRows, { home, env: process.env });
  const repo = initTempRepo();
  restores.push(swapEnv('CLASSIF_REPO', repo));
  const { promptSha256 } = writeSeriesRepo({ repo, k, routes, tuningIds: ['rr-tuning-1'], blindIds: ids,
    promptText: readFixture('l4/prompts/P98.md'), supports, ...(floors ? { floors } : {}) });
  if (seriesExtra) {
    const rel = `tools/classif/l4/manifests/series-${k}.json`;
    const m = JSON.parse(readFileSync(path.join(repo, rel), 'utf8'));
    writeRepoFile(repo, rel, JSON.stringify({ ...m, ...seriesExtra }));
  }
  writeRepoFile(repo, `tools/classif/l4/manifests/series-${k}-dev.json`, JSON.stringify({ kind: 'l4-dev', series: k, promptSha256, routes }));
  writeRepoFile(repo, 'tools/classif/l3/manifests/reference-d.json', JSON.stringify({ hashes: { blindPlain: seal.plainSha256, blindSealed: seal.sealedSha256 } }));
  commitAll(repo);
  const evalDir = tmp('l4blind-eval-');
  restores.push(swapEnv('CLASSIF_EVAL_DIR', evalDir));
  const rows = ['eval-1', 'eval-2'].map((evalId) => ({ evalId, input: `avis de motion, dossier ${evalId}, six logements zone H-9.` }));
  const inR = sealToFile(evalKey, Buffer.from(`${rows.map((r) => JSON.stringify(r)).join('\n')}\n`), path.join(evalDir, 'eval-inputs.jsonl.sealed'));
  const exR = sealToFile(evalKey, Buffer.from(`${rows.map((r) => JSON.stringify({ evalId: r.evalId, verdict: 'pertinent', code: 'P-DENSITE' })).join('\n')}\n`),
    path.join(evalDir, 'eval-expected.jsonl.sealed'));
  writeFileSync(path.join(evalDir, 'README.md'),
    `| Sealed file | Content | SHA-256 of plaintext |\n|---|---|---|\n| \`eval-inputs.jsonl.sealed\` | x | \`${inR.plainSha256}\` |\n| \`eval-expected.jsonl.sealed\` | x | \`${exR.plainSha256}\` |\n`);
  const restoreSeats = fakeSeats();
  return { repo, cleanup: () => { restoreSeats(); while (restores.length) restores.pop()(); rmSync(repo, { recursive: true, force: true }); rmSync(evalDir, { recursive: true, force: true }); } };
}

export const callsOf = (home) => {
  const f = path.join(home, 'l2', 'calls.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
export const auditOf = (home) => readFileSync(path.join(home, 'blind', 'access-log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** One blind pass of series k over `routes` with the fake-seat modes in `fake` ({FAKE_GLM, ...}). */
export async function blindPass(home, { k, routes, fake = {}, argv = [] }) {
  const restores = Object.entries(fake).map(([key, v]) => swapEnv(key, v));
  const before = callsOf(home).length;
  const { main } = await import('../l4/blind.mjs');
  const skip = EVAL_ROUTES.filter((r) => !routes.includes(r));
  let manifest = null;
  let error = null;
  try { manifest = await main(['--series', k, '--deferred', skip.join(','), '--concurrency', '8', ...argv]); }
  catch (e) { error = e; }
  finally { while (restores.length) restores.pop()(); }
  return { manifest, error, calls: callsOf(home).slice(before) };
}

export const readAggregates = (home, k) => JSON.parse(readFileSync(path.join(home, 'blind', `series-${k}-aggregates.json`), 'utf8'));
export const SCORE_KEYS = ['perRoute', 's113', '"stats"', 'recall"', 'recallLB', 'precision', '"failures"', 'verdict', 'withUnresolved', 'regressed', 'baselineRecall'];
