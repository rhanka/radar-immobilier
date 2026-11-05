// Fix-2 integration tests (review delta §3–§12, N1–N7): hermetic.
// Real mains/CLI where behavior demands it (§3b, §4, §5, N1, N3, N4, N5, N2, §9a);
// pure unit checks where noted (§3a, N5 parsers, §7a). No paid call: seats faked
// via PATH binaries; temp CLASSIF_HOME in test mode with fake seat-auth and vibe
// configs; repo manifests (split, series, amend, reference-d, blind) always land
// in a temp repo via CLASSIF_REPO — never the real checkout, seat homes, or hosts.
// Each test fails BEHAVIOURALLY on bcb704ca5 (assertion/throw, never import).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { runPass, loadCodes } from '../l2/run.mjs';
import { spent } from '../lib/budget.mjs';
import { splitGrouped, seededRng } from '../l3/split.mjs';
import { hasTracedAmend } from '../l2/converge.mjs';
import { parseProposalList, parseBallot } from '../l2/amend.mjs';
import { CLASSIF_DIR, commitAll, initTempRepo, readFixture, swapEnv, tmp, withTempHome, writeRepoFile, writeSeriesRepo } from './hermetic-helpers.mjs';

/** Minimal runPass home: 1 signal item, fake pack, profile prompt, empty fingerprints. */
async function setupRunHome(home, itemId = 'fix2-i1') {
  const { sha256 } = await import('../lib/render.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const items = [{ itemId, kind: 'signal', anchor: { id: 'n1', citySlug: 'ville-test' }, input: 'avis de motion du reglement 9001-9 afin de permettre six logements dans la zone H-9.' }];
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const body = `${items.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), body);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: items.length, sha256: sha256(body) }));
  mkdirSync(path.join(home, 'l1', 'pack'), { recursive: true });
  writeFileSync(path.join(home, 'l1', 'pack', 'criteria.md'), 'criteres fictifs');
  writeFileSync(path.join(home, 'l1', 'pack', 'codes-definitions.md'), 'definitions fictives');
  writeFileSync(path.join(home, 'l1', 'pack', 'guide-G0.md'), 'guide G0 fictif');
  mkdirSync(path.join(home, 'l1', 'engram-work'), { recursive: true });
  writeFileSync(path.join(home, 'l1', 'engram-work', 'profile-prompt.md'), 'profil fictif');
  mkdirSync(path.join(home, 'guard'), { recursive: true });
  const salt = 'fix2-salt';
  writeFileSync(path.join(home, 'guard', 'salt'), `${salt}\n`);
  writeFileSync(path.join(home, 'guard', 'fingerprints.json'), JSON.stringify(buildFingerprints(salt, { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['texte scelle fictif jamais dans le prompt'] })));
  return items;
}

/** Fake PATH bin dir with an executable `name` running `script` (sh). Returns {bin, restore}. */
function fakeBin(name, script) {
  const bin = tmp('fix2-bin-');
  const file = path.join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  chmodSync(file, 0o755);
  const prev = process.env.PATH;
  process.env.PATH = `${bin}:${prev}`;
  return { bin, restore: () => { process.env.PATH = prev; rmSync(bin, { recursive: true, force: true }); } };
}
function callsLines(home) {
  const f = path.join(home, 'l2', 'calls.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.trim());
}

// §5/N3 via the real runPass: intent BEFORE the call, quota refusal free (intent:false),
// one counted intent per attempt. Fake `muse`: quota denial once (stderr, Resets in 1s)
// then a valid vote. On bcb704ca5 the quota retry writes a second counted intent.
test('fix2 §5/N3: runPass records intent before the call and quota retries free', withTempHome(async (home) => {
  const items = await setupRunHome(home);
  const codes = loadCodes();
  const code = [...codes.keys()][0];
  const prevWait = process.env.CLASSIF_TEST_QUOTA_WAIT_MS;
  process.env.CLASSIF_TEST_QUOTA_WAIT_MS = '5';
  const counter = path.join(home, 'muse-count');
  writeFileSync(counter, '0');
  const answer = JSON.stringify({ annotations: [{ item_id: items[0].itemId, code, ambiguous: false, quote: 'avis de motion', reason: 'test' }] });
  const fb = fakeBin('muse', [
    `c=$(cat "${counter}"); echo $((c+1)) > "${counter}"`,
    'if [ "$c" = "0" ]; then echo "quota reached, Resets in 1s" >&2; echo "{}"; exit 0; fi',
    `printf '%s' '${answer.replace(/'/g, "'\\''")}'`,
    'exit 0',
  ].join('\n'));
  try {
    await runPass({ pass: 1, mode: 'independent', guide: 'G0', annotators: ['muse-wonder-max'], home, concurrency: 1, log: () => {} });
    const lines = callsLines(home).map((l) => JSON.parse(l));
    const intents = lines.filter((r) => r.intent !== false);
    const quotaFrees = lines.filter((r) => r.intent === false && r.quota === true);
    assert.equal(intents.length, 1, `one counted intent per attempt, got ${intents.length}: ${JSON.stringify(lines)}`);
    assert.equal(quotaFrees.length, 1, `quota refusal traced free, got ${JSON.stringify(lines)}`);
    assert.equal(spent(home), 1);
    assert.ok(intents[0].promptSha256, 'intent carries the prompt sha');
  } finally {
    fb.restore();
    if (prevWait === undefined) delete process.env.CLASSIF_TEST_QUOTA_WAIT_MS; else process.env.CLASSIF_TEST_QUOTA_WAIT_MS = prevWait;
  }
}));

// N1 via real spent + real runPass resume: a truncated last line does not kill resume.
// On bcb704ca5 spent throws on the truncated tail.
test('fix2 N1: kill-truncated calls.jsonl resumes without losing the budget', withTempHome(async (home) => {
  const items = await setupRunHome(home);
  const codes = loadCodes();
  const code = [...codes.keys()][0];
  const answer = JSON.stringify({ annotations: [{ item_id: items[0].itemId, code, ambiguous: false, quote: 'avis de motion', reason: 'test' }] });
  const fb = fakeBin('muse', `printf '%s' '${answer.replace(/'/g, "'\\''")}'\nexit 0`);
  try {
    await runPass({ pass: 1, mode: 'independent', guide: 'G0', annotators: ['muse-wonder-max'], home, concurrency: 1, log: () => {} });
    const before = spent(home);
    assert.equal(before, 1);
    const f = path.join(home, 'l2', 'calls.jsonl');
    writeFileSync(f, `${readFileSync(f, 'utf8')}{"intent":true,"phase":"pass1","trunca`);
    assert.equal(spent(home), 2, 'truncated intent tail counts 1 fail-closed');
    const r2 = await runPass({ pass: 1, mode: 'independent', guide: 'G0', annotators: ['muse-wonder-max'], home, concurrency: 1, log: () => {} });
    assert.equal(r2.calls, 0, 'finished lots are not repaid on resume');
  } finally { fb.restore(); }
}));

// §3a: two seeds give different halves on a multi-city fixture (seeded draw core).
// On bcb704ca5 the alphabetical tie-break neutralises the shuffle: same halves.
test('fix2 §3a: two seeds draw different halves on a multi-city fixture', () => {
  const cities = [
    { city: 'alpha', items: [{ id: 'a1', stratum: 's' }, { id: 'a2', stratum: 's' }] },
    { city: 'beta', items: [{ id: 'b1', stratum: 's' }, { id: 'b2', stratum: 's' }] },
    { city: 'gamma', items: [{ id: 'c1', stratum: 's' }, { id: 'c2', stratum: 's' }] },
    { city: 'delta', items: [{ id: 'd1', stratum: 's' }, { id: 'd2', stratum: 's' }] },
    { city: 'epsilon', items: [{ id: 'e1', stratum: 's' }, { id: 'e2', stratum: 's' }] },
    { city: 'zeta', items: [{ id: 'f1', stratum: 's' }, { id: 'f2', stratum: 's' }] },
  ];
  const targets = new Map([['s', 6]]);
  const h1 = splitGrouped(cities, targets, seededRng('fix2-seed-1'));
  const h1b = splitGrouped(cities, targets, seededRng('fix2-seed-1'));
  const h2 = splitGrouped(cities, targets, seededRng('fix2-seed-2'));
  assert.deepEqual(h1, h1b, 'same seed reproduces');
  assert.notDeepEqual(h1, h2, 'two seeds must draw different halves');
});

// §3b via the real pass CLI: an absent, uncommitted or dirty split.json is refused.
// Hermetic: the CLI runs against a temp repo (CLASSIF_REPO + CLASSIF_TEST_MODE),
// never the real checkout. On bcb704ca5 the CLI checks existence only.
test('fix2 §3b: real pass CLI refuses an absent, uncommitted or dirty split.json', withTempHome(async (home) => {
  const repo = initTempRepo();
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  const splitRel = 'tools/classif/l3/manifests/split.json';
  try {
    const runCli = () => spawnSync('node', [path.join(CLASSIF_DIR, 'l2', 'run.mjs'), '--pass', '2', '--half', 'tuning'],
      { encoding: 'utf8', env: { ...process.env, CLASSIF_HOME: home } });
    let r = runCli();
    assert.equal(r.status, 2, `CLI must refuse an absent split (exit 2), got ${r.status}: ${r.stderr}${r.stdout}`);
    assert.match(r.stderr, /absent/, `refusal must name the absence, got: ${r.stderr}`);
    writeRepoFile(repo, splitRel, JSON.stringify({ halves: { tuning: ['x'], blind: ['y'] } }));
    r = runCli();
    assert.equal(r.status, 2, `CLI must refuse an uncommitted split (exit 2), got ${r.status}: ${r.stderr}${r.stdout}`);
    assert.match(r.stderr, /not committed/, `refusal must name the commit, got: ${r.stderr}`);
    commitAll(repo);
    writeRepoFile(repo, splitRel, JSON.stringify({ halves: { tuning: ['x', 'z'], blind: ['y'] } }));
    r = runCli();
    assert.equal(r.status, 2, `CLI must refuse a dirty split (exit 2), got ${r.status}: ${r.stderr}${r.stdout}`);
    assert.match(r.stderr, /differs from the committed/, `refusal must name the drift, got: ${r.stderr}`);
  } finally {
    restoreRepo();
    rmSync(repo, { recursive: true, force: true });
  }
}));

// F1 via the real split.main: the committed seed drives the draw in a temp repo.
// Hermetic: temp CLASSIF_HOME + temp repo (CLASSIF_REPO + CLASSIF_TEST_MODE), never
// the real checkout. On 9d1bec39c split.main throws ReferenceError (REPO undefined)
// as soon as the seed file exists.
test('fix2 F1: real split.main draws halves from the committed seed', withTempHome(async (home) => {
  const { sha256 } = await import('../lib/render.mjs');
  const { ANNOTATORS } = await import('../l2/run.mjs');
  const items = [
    { itemId: 'f1-i1', kind: 'signal', anchor: { id: 'n1', citySlug: 'ville-a' }, input: 'avis de motion du reglement 9001-9 afin de permettre six logements dans la zone H-9, dossier f1-1.' },
    { itemId: 'f1-i2', kind: 'signal', anchor: { id: 'n2', citySlug: 'ville-a' }, input: 'avis de motion du reglement 9001-9 afin de permettre six logements dans la zone H-9, dossier f1-2.' },
    { itemId: 'f1-i3', kind: 'signal', anchor: { id: 'n3', citySlug: 'ville-b' }, input: 'avis de motion du reglement 9001-9 afin de permettre six logements dans la zone H-9, dossier f1-3.' },
    { itemId: 'f1-i4', kind: 'signal', anchor: { id: 'n4', citySlug: 'ville-b' }, input: 'avis de motion du reglement 9001-9 afin de permettre six logements dans la zone H-9, dossier f1-4.' },
  ];
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const body = `${items.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), body);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: items.length, sha256: sha256(body) }));
  const mkVote = (id) => ({ itemId: id, kind: 'signal', valid: true, code: 'P-DENSITE', verdict: 'pertinent', ambiguous: false, cause: null, quote: 'avis de motion', reason: 'r', changed: false, quoteFound: true });
  for (const a of ANNOTATORS) {
    const d = path.join(home, 'l2', 'pass1', a);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 's001.json'), JSON.stringify({ pass: 1, annotator: a, lotId: 's001', exitCode: 0, attempts: 1,
      annotations: items.map((i) => mkVote(i.itemId)) }));
  }
  const repo = initTempRepo();
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  const seedRel = 'tools/classif/l3/manifests/split-seed.json';
  const seed = 'fix2-split-seed-f1';
  try {
    writeRepoFile(repo, 'tools/classif/l0/manifests/signal-draw-manifest.json',
      JSON.stringify({ items: items.map((i) => ({ itemId: i.itemId, pass: 'B1' })) }));
    writeRepoFile(repo, seedRel, JSON.stringify({ seed, committedAt: new Date().toISOString() }));
    const { main: splitMain } = await import('../l3/split.mjs');
    await assert.rejects(() => splitMain([]), /not committed/, 'uncommitted seed must refuse the draw');
    commitAll(repo);
    const realSplit = path.join(CLASSIF_DIR, 'l3', 'manifests', 'split.json');
    const realBefore = existsSync(realSplit) ? readFileSync(realSplit, 'utf8') : null;
    const manifest = await splitMain([]);
    assert.equal(manifest.kind, 'split');
    assert.equal(manifest.seed, seed);
    assert.equal(manifest.seedFile, seedRel, 'seedFile stays repo-relative to the temp repo root');
    assert.ok(Array.isArray(manifest.halves.tuning) && Array.isArray(manifest.halves.blind), 'manifest carries both halves');
    assert.deepEqual([...manifest.halves.tuning, ...manifest.halves.blind].sort(), items.map((i) => i.itemId).sort(), 'halves cover every item exactly once');
    assert.equal(manifest.cityOverlap, 0, 'no city lands in both halves');
    assert.ok(manifest.sha256?.tuning && manifest.sha256?.blind, 'halves carry their shas');
    assert.ok(existsSync(path.join(repo, 'tools', 'classif', 'l3', 'manifests', 'split.json')), 'draw lands in the temp repo');
    const realAfter = existsSync(realSplit) ? readFileSync(realSplit, 'utf8') : null;
    assert.equal(realAfter, realBefore, 'real checkout split.json unchanged by the temp draw');
    await assert.rejects(() => splitMain([]), /already holds a draw/, 'a committed draw refuses a silent redraw');
    rmSync(path.join(repo, 'tools', 'classif', 'l3', 'manifests', 'split.json'));
    writeRepoFile(repo, seedRel, JSON.stringify({ seed: 'fix2-split-seed-dirty', committedAt: new Date().toISOString() }));
    await assert.rejects(() => splitMain([]), /differs from the committed/, 'dirty seed must refuse the draw');
  } finally {
    restoreRepo();
    rmSync(repo, { recursive: true, force: true });
  }
}));

// §7a via the real converge stop path: a gel-only round never unlocks the stop.
// Hermetic: explicit dirs, plus the default dir pointed at a temp repo — never
// the real checkout. On bcb704ca5 hasTracedAmend counts gel files.
test('fix2 §7a: freeze-only amend round does not allow the stop', () => {
  const dir = tmp('fix2-amend-');
  try {
    writeFileSync(path.join(dir, 'amend-G9.json'), JSON.stringify({ kind: 'guide-amendment', gel: true }));
    assert.equal(hasTracedAmend(dir), false, 'gel-only round is not a traced round');
    writeFileSync(path.join(dir, 'amend-G1.json'), JSON.stringify({ kind: 'guide-amendment', gel: false }));
    assert.equal(hasTracedAmend(dir), true, 'a real round traces');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const repo = initTempRepo();
  const restoreMode = swapEnv('CLASSIF_TEST_MODE', '1');
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  try {
    assert.equal(hasTracedAmend(), false, 'empty temp repo manifests dir has no traced round');
    writeRepoFile(repo, 'tools/classif/l2/manifests/amend-G9.json', JSON.stringify({ kind: 'guide-amendment', gel: true }));
    assert.equal(hasTracedAmend(), false, 'temp repo with only a gel file has no traced round');
  } finally {
    restoreRepo();
    restoreMode();
    rmSync(repo, { recursive: true, force: true });
  }
});

// §4 via the real pass CLI: blind half demands crossreview mode (and a sha-checked FINAL).
// On bcb704ca5 `--mode independent --guide FINAL --half blind` passes the firewall.
test('fix2 §4: real pass CLI refuses independent blind review', withTempHome(async (home) => {
  const packDir = path.join(home, 'l1', 'pack');
  mkdirSync(packDir, { recursive: true });
  writeFileSync(path.join(packDir, 'guide-FINAL.md'), 'fake final guide');
  const r = spawnSync('node', [path.join(CLASSIF_DIR, 'l2', 'run.mjs'), '--pass', '2', '--mode', 'independent', '--guide', 'FINAL', '--half', 'blind'],
    { encoding: 'utf8', env: { ...process.env, CLASSIF_HOME: home } });
  assert.equal(r.status, 2, `CLI must refuse (exit 2), got ${r.status}: ${r.stderr}${r.stdout}`);
  assert.match(r.stderr, /crossreview/i, `refusal must name crossreview, got: ${r.stderr}`);
}));

// N5 via pure parsers (fail-closed tool gate) — the amendMain behaviour is covered next.
// On bcb704ca5 a tool-using ballot still counts.
test('fix2 N5 parsers: toolEvents nulls amend proposals and votes', () => {
  const good = { code: 0, toolEvents: 0, text: '{"amendments":[{"rule":"Do X properly stated.","rationale":"Y"}]}' };
  assert.equal(parseProposalList(good).length, 1);
  assert.deepEqual(parseBallot({ code: 0, toolEvents: 0, text: '{"votes":{"X1":true}}' }), { X1: true });
  const tool = { code: 0, toolEvents: 2, text: '{"amendments":[{"rule":"Do X.","rationale":"Y"}]}' };
  assert.deepEqual(parseProposalList(tool), [], 'tool proposal must contribute nothing');
  assert.deepEqual(parseBallot({ code: 0, toolEvents: 1, text: '{"votes":{"X1":true}}' }), {}, 'tool vote must contribute nothing');
});

// N5 via the real amendMain: a tool-using seat contributes no proposal and no vote.
// Fake seats: `muse`/`claude` clean, `codex` (astra) emits an mcp_tool_call stream with a
// proposal/vote payload. Split: temp committed split via CLASSIF_REPO (test mode).
// On bcb704ca5 the astra tool proposal is adopted.
test('fix2 N5: real amendMain nulls tool-using contributions', withTempHome(async (home) => {
  const { sha256 } = await import('../lib/render.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const items = [
    { itemId: 'n5-i1', kind: 'signal', anchor: { id: 'n1', citySlug: 'v' }, input: 'avis de motion du reglement 9001-9 afin de permettre six logements dans la zone H-9.' },
    { itemId: 'n5-i2', kind: 'signal', anchor: { id: 'n2', citySlug: 'v' }, input: 'proces-verbal du conseil mentionnant six logements dans la zone H-9.' },
  ];
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const body = `${items.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), body);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: items.length, sha256: sha256(body) }));
  mkdirSync(path.join(home, 'l1', 'pack'), { recursive: true });
  writeFileSync(path.join(home, 'l1', 'pack', 'criteria.md'), 'criteres');
  writeFileSync(path.join(home, 'l1', 'pack', 'codes-definitions.md'), 'definitions');
  writeFileSync(path.join(home, 'l1', 'pack', 'guide-G0.md'), 'guide G0');
  mkdirSync(path.join(home, 'guard'), { recursive: true });
  writeFileSync(path.join(home, 'guard', 'salt'), 'fix2-salt\n');
  writeFileSync(path.join(home, 'guard', 'fingerprints.json'), JSON.stringify(buildFingerprints('fix2-salt', { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['scelle fictif'] })));
  const codes = loadCodes();
  const code = [...codes.keys()][0];
  const mkVote = (id) => ({ itemId: id, kind: 'signal', valid: true, code, verdict: codes.get(code), ambiguous: true, cause: null, quote: 'avis de motion', reason: 'r', changed: false, quoteFound: true });
  for (const a of ['muse-wonder-max', 'astra-max', 'opus-5.5-max']) {
    const d = path.join(home, 'l2', 'pass1', a);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 's001.json'), JSON.stringify({ pass: 1, annotator: a, lotId: 's001', exitCode: 0, attempts: 1,
      annotations: items.map((i) => mkVote(i.itemId)) }));
  }
  mkdirSync(path.join(home, 'l2', 'pass2'), { recursive: true });
  writeFileSync(path.join(home, 'l2', 'pass2', 'todo.json'), JSON.stringify({ fromPass: 1, items: items.map((i) => i.itemId) }));
  // Hermetic split fixture: committed split in a temp repo (test mode), never the
  // real checkout.
  const tmpRepo = initTempRepo();
  const restoreRepo = swapEnv('CLASSIF_REPO', tmpRepo);
  writeRepoFile(tmpRepo, 'tools/classif/l3/manifests/split.json',
    JSON.stringify({ halves: { tuning: items.map((i) => i.itemId), blind: [] } }));
  commitAll(tmpRepo);
  let fbMuse = null; let fbClaude = null; let fbCodex = null;
  try {
    // Decisive tool vote: propose is clean everywhere (one rule X1); the vote is
    // muse=yes, claude=no, codex=yes-WITH-tool-event. Fixed code nulls the codex vote
    // (1 yes → not adopted); bcb704ca5 counts it (2 yes → adopted).
    const rule = JSON.stringify({ amendments: [{ rule: 'Fix2 quorum rule for tool decisive vote.', rationale: 'R' }] });
    const yesVote = JSON.stringify({ votes: { X1: true } });
    const noVote = JSON.stringify({ votes: { X1: false } });
    const mc = path.join(home, 'muse-n5-count');
    const cc = path.join(home, 'claude-n5-count');
    const xc = path.join(home, 'codex-n5-count');
    writeFileSync(mc, '0'); writeFileSync(cc, '0'); writeFileSync(xc, '0');
    fbMuse = fakeBin('muse', [
      `c=$(cat "${mc}"); echo $((c+1)) > "${mc}"`,
      `if [ "$c" = "0" ]; then printf '%s' '${rule.replace(/'/g, "'\\''")}'; else printf '%s' '${yesVote.replace(/'/g, "'\\''")}'; fi`,
      'exit 0',
    ].join('\n'));
    fbClaude = fakeBin('claude', [
      `c=$(cat "${cc}"); echo $((c+1)) > "${cc}"`,
      `if [ "$c" = "0" ]; then printf '%s' '{"amendments":[]}'; else printf '%s' '${noVote.replace(/'/g, "'\\''")}'; fi`,
      'exit 0',
    ].join('\n'));
    // codex propose: benign stream with empty amendments; codex vote: tool stream + yes vote.
    const codexClean = [
      JSON.stringify({ type: 'thread.started', thread_id: 't' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"amendments":[]}' } }),
      JSON.stringify({ type: 'turn.completed', usage: {} }),
    ].join('\n');
    const codexToolVote = [
      JSON.stringify({ type: 'thread.started', thread_id: 't' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'x', tool: 'search' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: yesVote } }),
      JSON.stringify({ type: 'turn.completed', usage: {} }),
    ].join('\n');
    fbCodex = fakeBin('codex', [
      `c=$(cat "${xc}"); echo $((c+1)) > "${xc}"`,
      `if [ "$c" = "0" ]; then printf '%s' '${codexClean.replace(/'/g, "'\\''")}'; else printf '%s' '${codexToolVote.replace(/'/g, "'\\''")}'; fi`,
      'exit 0',
    ].join('\n'));
    const { main: amendMain } = await import('../l2/amend.mjs');
    const rep = await amendMain(['--from', 'G0', '--to', 'G9FIX2', '--pass', '1', '--half', 'tuning']);
    const adoptedCount = Array.isArray(rep.adopted) ? rep.adopted.length : (rep.adopted ?? 0);
    assert.equal(adoptedCount, 0, `tool-using contributions must adopt nothing, got ${JSON.stringify(rep).slice(0, 300)}`);
    // Hermetic: the manifest landed in the temp repo, never in the real checkout.
    assert.ok(existsSync(path.join(tmpRepo, 'tools', 'classif', 'l2', 'manifests', 'amend-G9FIX2.json')),
      'amend manifest must land in the temp repo');
    assert.ok(!existsSync(path.join(CLASSIF_DIR, 'l2', 'manifests', 'amend-G9FIX2.json')),
      'amend manifest must never touch the real checkout');
  } finally {
    if (fbMuse) fbMuse.restore();
    if (fbClaude) fbClaude.restore();
    if (fbCodex) fbCodex.restore();
    restoreRepo();
    rmSync(tmpRepo, { recursive: true, force: true });
    const out = path.join(home, 'l1', 'pack', 'guide-G9FIX2.md');
    if (existsSync(out)) rmSync(out);
  }
}));

/** L4 dev home for series 98: tuning rows (P-DENSITE/pertinent) + corpus + guard. */
async function setupDev98(home, n = 40) {
  const { sha256 } = await import('../lib/render.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const items = Array.from({ length: n }, (_, i) => ({
    itemId: `dev98-i${String(i + 1).padStart(3, '0')}`,
    kind: 'signal',
    anchor: { id: `n${i + 1}`, citySlug: 'ville-test' },
    input: `avis de motion du reglement 9001-9 afin de permettre six logements dans la zone H-9, dossier dev98-${i + 1}.`,
  }));
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const body = `${items.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), body);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: items.length, sha256: sha256(body) }));
  mkdirSync(path.join(home, 'l3b'), { recursive: true });
  const ref = items.map((i) => ({ itemId: i.itemId, kind: 'signal', code: 'P-DENSITE', verdict: 'pertinent', status: 'resolved', half: 'tuning' }));
  writeFileSync(path.join(home, 'l3b', 'reference-d.jsonl'), `${ref.map((r) => JSON.stringify(r)).join('\n')}\n`);
  mkdirSync(path.join(home, 'guard'), { recursive: true });
  writeFileSync(path.join(home, 'guard', 'salt'), 'fix2-salt\n');
  writeFileSync(path.join(home, 'guard', 'fingerprints.json'), JSON.stringify(buildFingerprints('fix2-salt', { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['scelle fictif dev98'] })));
  return items;
}

// N4 via the real devMain (series 98): failed rows are retried, not cached forever.
// Fake `vibe` fails once (exit 1) then answers P-DENSITE (vibe message-array format,
// which parseVibe extracts). Hermetic: series repo in a temp repo. On bcb704ca5
// the failure is cached and never retried.
test('fix2 N4: real devMain retries failed rows on resume', withTempHome(async (home) => {
  const items = await setupDev98(home, 3);
  const counter = path.join(home, 'vibe-count');
  writeFileSync(counter, '0');
  const inner = JSON.stringify({ verdict: 'pertinent', code: 'P-DENSITE' });
  const good = JSON.stringify([{ role: 'assistant', type: 'message', content: [{ type: 'text', text: inner }] }]);
  const fb = fakeBin('vibe', [
    `c=$(cat "${counter}"); echo $((c+1)) > "${counter}"`,
    `if [ "$c" -lt 3 ]; then echo "boom" >&2; exit 1; fi`,
    `printf '%s' '${good}'`,
    'exit 0',
  ].join('\n'));
  const repo = initTempRepo();
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  writeSeriesRepo({ repo, k: '98', routes: ['glm-5.3-low'], tuningIds: items.map((i) => i.itemId),
    blindIds: ['fix2-blind-1'], promptText: readFixture('l4/prompts/P98.md'), supports: { recall: 30, precision: 30 } });
  try {
    const { main: devMain, EVAL_ROUTES } = await import('../l4/dev.mjs');
    const only = 'glm-5.3-low';
    assert.ok(EVAL_ROUTES.includes(only), `test route ${only} must exist`);
    const skip = EVAL_ROUTES.filter((r) => r !== only);
    await devMain(['--series', '98', '--deferred', skip.join(','), '--concurrency', '1']);
    const rows1 = readFileSync(path.join(home, 'l4', 'series-98', `dev-${only}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(rows1.some((r) => r.failed), 'first run must have failures');
    const callsAfterFirst = callsLines(home).filter((l) => JSON.parse(l).intent !== false).length;
    await devMain(['--series', '98', '--deferred', skip.join(','), '--concurrency', '1']);
    const rows2 = readFileSync(path.join(home, 'l4', 'series-98', `dev-${only}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(rows2.every((r) => !r.failed), `resume must retry failures to success, got ${JSON.stringify(rows2).slice(0, 300)}`);
    const callsAfterSecond = callsLines(home).filter((l) => JSON.parse(l).intent !== false).length;
    assert.ok(callsAfterSecond > callsAfterFirst, 'retry must count new intents');
    // Hermetic: the dev manifest landed in the temp repo, never in the real checkout.
    assert.ok(existsSync(path.join(repo, 'tools', 'classif', 'l4', 'manifests', 'series-98-dev.json')),
      'dev manifest must land in the temp repo');
    assert.ok(!existsSync(path.join(CLASSIF_DIR, 'l4', 'manifests', 'series-98-dev.json')),
      'dev manifest must never touch the real checkout');
  } finally {
    fb.restore();
    restoreRepo();
    rmSync(repo, { recursive: true, force: true });
  }
}));

// §9a via the real devMain (series 98, supports 1000/1000): 40 shown refs still indeterminate.
// Hermetic: series repo with its own halves in a temp repo. On bcb704ca5 supports
// default to 30/30, so the verdict is pass, not indeterminate.
test('fix2 §9a: real devMain drives indeterminate from series supports', withTempHome(async (home) => {
  const items = await setupDev98(home, 40);
  const inner = JSON.stringify({ verdict: 'pertinent', code: 'P-DENSITE' });
  const good = JSON.stringify([{ role: 'assistant', type: 'message', content: [{ type: 'text', text: inner }] }]);
  const fb = fakeBin('vibe', `printf '%s' '${good}'\nexit 0`);
  const repo = initTempRepo();
  const restoreRepo = swapEnv('CLASSIF_REPO', repo);
  writeSeriesRepo({ repo, k: '98', routes: ['glm-5.3-low'], tuningIds: items.map((i) => i.itemId),
    blindIds: ['fix2-blind-1'], promptText: readFixture('l4/prompts/P98.md'), supports: { recall: 1000, precision: 1000 } });
  try {
    const { main: devMain, EVAL_ROUTES } = await import('../l4/dev.mjs');
    const only = 'glm-5.3-low';
    const skip = EVAL_ROUTES.filter((r) => r !== only);
    const rep = await devMain(['--series', '98', '--deferred', skip.join(','), '--concurrency', '2']);
    const agg = rep.aggregates[only];
    assert.ok(agg, `aggregates must carry ${only}`);
    assert.equal(agg.verdict, 'indeterminate', `40 shown refs with supports 1000 must be indeterminate, got ${agg.verdict} ${JSON.stringify(agg.indeterminate)}`);
    assert.deepEqual(agg.indeterminate, { recall: true, precision: true });
    // Hermetic: the dev manifest landed in the temp repo, never in the real checkout.
    assert.ok(existsSync(path.join(repo, 'tools', 'classif', 'l4', 'manifests', 'series-98-dev.json')),
      'dev manifest must land in the temp repo');
    assert.ok(!existsSync(path.join(CLASSIF_DIR, 'l4', 'manifests', 'series-98-dev.json')),
      'dev manifest must never touch the real checkout');
  } finally {
    fb.restore();
    restoreRepo();
    rmSync(repo, { recursive: true, force: true });
  }
}));

// Hermetic blind-series fixture (review D2): temp home (corpus, guard, blind seal)
// + temp repo (prompt, split, series, dev and reference-d manifests) + temp eval dir.
// Returns the handles the blind tests need. Nothing touches the real checkout.
async function setupBlind98(home) {
  const { sha256 } = await import('../lib/render.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const { newKey } = await import('./fixture.mjs');
  const { ROUTES } = await import('../run-seat.mjs');
  const only = 'glm-5.3-low';
  const { model, effort } = ROUTES[only];
  const blindIds = ['b98-1', 'b98-2'];
  const blindRows = blindIds.map((id) => ({ itemId: id, kind: 'signal', code: 'P-DENSITE', verdict: 'pertinent', status: 'resolved' }));
  const corpus = blindRows.map((r) => ({ itemId: r.itemId, kind: 'signal', anchor: { id: `n-${r.itemId}`, citySlug: 'v' }, input: `texte blind ${r.itemId} six logements zone H-9.` }));
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const cbody = `${corpus.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), cbody);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: corpus.length, sha256: sha256(cbody) }));
  mkdirSync(path.join(home, 'guard'), { recursive: true });
  writeFileSync(path.join(home, 'guard', 'salt'), 'fix2-salt\n');
  writeFileSync(path.join(home, 'guard', 'fingerprints.json'), JSON.stringify(buildFingerprints('fix2-salt', { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['scelle fictif blind98'] })));
  const restores = [swapEnv('CLASSIF_ROLE', 'test-executor'), swapEnv('CLASSIF_ACTOR', 'fix2-test')];
  restores.push(swapEnv('CLASSIF_BLIND_KEY', newKey().toString('base64')));
  const { sealBlindSet, blindDir, audit } = await import('../lib/blind.mjs');
  const { privateDir } = await import('../lib/paths.mjs');
  const seal = sealBlindSet(blindRows, { home, env: process.env });
  const promptText = readFixture('l4/prompts/P98.md');
  const repo = initTempRepo();
  restores.push(swapEnv('CLASSIF_REPO', repo));
  const { promptSha256 } = writeSeriesRepo({ repo, k: '98', routes: [only], tuningIds: ['fix2-tuning-1'],
    blindIds, promptText, supports: { recall: 30, precision: 30 } });
  writeRepoFile(repo, 'tools/classif/l4/manifests/series-98-dev.json',
    JSON.stringify({ kind: 'l4-dev', series: '98', promptSha256, routes: [only] }));
  writeRepoFile(repo, 'tools/classif/l3/manifests/reference-d.json',
    JSON.stringify({ hashes: { blindPlain: seal.plainSha256, blindSealed: seal.sealedSha256 } }));
  commitAll(repo);
  // Private aggregates: blind route done and audited, verified at the prompt sha.
  const outDir = privateDir(blindDir(home));
  const stats = { scored: 2, refShown: 2, predShown: 2, recall: 1, recallLB: 0.9, precision: 1, precisionLB: 0.9, indeterminate: { recall: true, precision: true } };
  writeFileSync(path.join(outDir, `series-98-${only}.json`),
    JSON.stringify({ series: '98', route: only, model, effort, promptSha256, stats, withUnresolved: stats, failures: 0, verdict: 'indeterminate' }));
  audit({ action: 'blind-run', purpose: 'l4-blind-s98', promptSha256, model, effort, items: 2, failures: 0 }, { home, env: process.env });
  const evalDir = tmp('fix2-eval-');
  restores.push(swapEnv('CLASSIF_EVAL_DIR', evalDir));
  const cleanup = () => {
    while (restores.length) restores.pop()();
    rmSync(repo, { recursive: true, force: true });
    rmSync(evalDir, { recursive: true, force: true });
  };
  return { only, model, effort, blindIds, promptSha256, repo, evalDir, outDir, cleanup };
}

/** Minimal sealed eval dir (review N2): sealed inputs/expected + README hashes. */
async function setupSealedEvalDir(evalDir, evalKeyB64, rows) {
  const { sealToFile } = await import('../lib/refc1.mjs');
  const { Buffer } = await import('node:buffer');
  const key = Buffer.from(evalKeyB64, 'base64');
  mkdirSync(evalDir, { recursive: true });
  const inputs = rows.map((r) => ({ evalId: r.evalId, input: r.input }));
  const expected = rows.map((r) => ({ evalId: r.evalId, verdict: r.verdict, code: r.code }));
  const inBlob = Buffer.from(`${inputs.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const exBlob = Buffer.from(`${expected.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const inR = sealToFile(key, inBlob, path.join(evalDir, 'eval-inputs.jsonl.sealed'));
  const exR = sealToFile(key, exBlob, path.join(evalDir, 'eval-expected.jsonl.sealed'));
  writeFileSync(path.join(evalDir, 'README.md'),
    `| Sealed file | Content | SHA-256 of plaintext |\n|---|---|---|\n| \`eval-inputs.jsonl.sealed\` | x | \`${inR.plainSha256}\` |\n| \`eval-expected.jsonl.sealed\` | x | \`${exR.plainSha256}\` |\n`);
}

// N2 via the real blindMain (series 98): completed S113 routes are skipped — no second
// guard failure, no eval reopen. All blind + S113 done upfront, so no seat call and no
// sealed eval open. On bcb704ca5 there is no S113 skip: the re-run hits
// assertEvalRunAllowed and throws (no crash-proof series).
test('fix2 N2: real blindMain resumes completed S113 routes', withTempHome(async (home) => {
  const setup = await setupBlind98(home);
  try {
    const { only, model, effort, promptSha256, repo, evalDir, outDir } = setup;
    const s113agg = { scored: 1, recall: 1, indeterminate: {} };
    writeFileSync(path.join(outDir, `s113-series-98-${only}.json`),
      JSON.stringify({ series: '98', route: only, promptSha256, stats: s113agg, s113: { ...s113agg, flag: 'golden-exposed' } }));
    writeFileSync(path.join(evalDir, 'access-log.jsonl'),
      `${JSON.stringify({ at: new Date().toISOString(), actor: 'fix2-test', role: 'test-executor', action: 'eval-run', purpose: 'l4-s113-s98', promptSha256, model, effort, items: 1 })}\n`);
    const callsBefore = callsLines(home).length;
    const realBlind = path.join(CLASSIF_DIR, 'l4', 'manifests', 'series-98-blind.json');
    const realRefD = path.join(CLASSIF_DIR, 'l3', 'manifests', 'reference-d.json');
    const realBlindBefore = existsSync(realBlind) ? readFileSync(realBlind, 'utf8') : null;
    const realRefDBefore = existsSync(realRefD) ? readFileSync(realRefD, 'utf8') : null;
    const gitBefore = spawnSync('git', ['status', '--porcelain'], { cwd: CLASSIF_DIR, encoding: 'utf8' }).stdout;
    const { main: blindMain } = await import('../l4/blind.mjs');
    const { EVAL_ROUTES } = await import('../l4/dev.mjs');
    const skip = EVAL_ROUTES.filter((r) => r !== only);
    const rep = await blindMain(['--series', '98', '--deferred', skip.join(','), '--concurrency', '1']);
    assert.ok(rep.aggregatesSha256, 'blind resume must return a manifest');
    assert.equal(callsLines(home).length, callsBefore, 'resumed S113 must make no new seat call');
    // Hermetic: the blind manifest landed in the temp repo, never in the real checkout.
    assert.ok(existsSync(path.join(repo, 'tools', 'classif', 'l4', 'manifests', 'series-98-blind.json')),
      'blind manifest must land in the temp repo');
    assert.equal(existsSync(realBlind) ? readFileSync(realBlind, 'utf8') : null, realBlindBefore,
      'real checkout blind manifest unchanged by the temp run');
    assert.equal(existsSync(realRefD) ? readFileSync(realRefD, 'utf8') : null, realRefDBefore,
      'real checkout reference-d unchanged by the temp run');
    assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: CLASSIF_DIR, encoding: 'utf8' }).stdout, gitBefore,
      'real checkout git state unchanged by the temp run');
  } finally {
    setup.cleanup();
  }
}));

// N2b via the real blindMain (series 98): a PARTIAL S113 route resumes from its
// per-item caches — only the uncached eval id pays a new seat call, with no eval
// reopen beyond the single guarded open. Covers the review gap (N2 proved only the
// fully-completed skip, never a partial route).
test('fix2 N2b: real blindMain resumes a partial S113 route from per-item caches', withTempHome(async (home) => {
  const setup = await setupBlind98(home);
  const { newKey } = await import('./fixture.mjs');
  const evalKey = newKey().toString('base64');
  const restoreEvalKey = swapEnv('CLASSIF_EVAL_KEY', evalKey);
  try {
    const { only, promptSha256, repo, evalDir, outDir } = setup;
    const rows = ['eval-1', 'eval-2', 'eval-3'].map((evalId) => ({
      evalId, input: `avis de motion du reglement 9001-9, dossier ${evalId}, six logements zone H-9.`,
      verdict: 'pertinent', code: 'P-DENSITE',
    }));
    await setupSealedEvalDir(evalDir, evalKey, rows);
    // Two of three eval ids cached (verified key); eval-3 pays one new seat call.
    for (const evalId of ['eval-1', 'eval-2']) {
      writeFileSync(path.join(outDir, `s113-s98-${only}.${evalId}.json`), JSON.stringify({ series: '98',
        promptSha256, route: only, evalId, row: { failed: false, pred: { verdict: 'pertinent', code: 'P-DENSITE' } } }));
    }
    const inner = JSON.stringify({ verdict: 'pertinent', code: 'P-DENSITE' });
    const good = JSON.stringify([{ role: 'assistant', type: 'message', content: [{ type: 'text', text: inner }] }]);
    const fb = fakeBin('vibe', `printf '%s' '${good}'\nexit 0`);
    try {
      const s113IntentsBefore = callsLines(home).filter((l) => { const r = JSON.parse(l); return r.intent !== false && r.phase === 'l4-s113-s98'; }).length;
      const { main: blindMain } = await import('../l4/blind.mjs');
      const { EVAL_ROUTES } = await import('../l4/dev.mjs');
      const skip = EVAL_ROUTES.filter((r) => r !== only);
      const rep = await blindMain(['--series', '98', '--deferred', skip.join(','), '--concurrency', '1']);
      assert.ok(rep.aggregatesSha256, 'partial S113 resume must return a manifest');
      const s113File = JSON.parse(readFileSync(path.join(outDir, 's113-series-98-glm-5.3-low.json'), 'utf8'));
      assert.equal(s113File.stats.scored, 3, 'resumed S113 must score all 3 eval rows');
      const s113IntentsAfter = callsLines(home).filter((l) => { const r = JSON.parse(l); return r.intent !== false && r.phase === 'l4-s113-s98'; }).length;
      assert.equal(s113IntentsAfter - s113IntentsBefore, 1, 'only the uncached eval id pays a new seat call');
      assert.ok(existsSync(path.join(repo, 'tools', 'classif', 'l4', 'manifests', 'series-98-blind.json')),
        'blind manifest must land in the temp repo');
    } finally {
      fb.restore();
    }
  } finally {
    restoreEvalKey();
    setup.cleanup();
  }
}));
