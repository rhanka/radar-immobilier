// Fix-2 integration tests (review delta §3–§12, N1–N7): hermetic, real mains/CLI only.
// No paid call: seats faked via PATH binaries; CLASSIF_HOME always temp; never the real
// seat home, l2/pass1 or l2/calls.jsonl. Each test fails BEHAVIOURALLY on bcb704ca5
// (assertion/throw, never import): only pre-existing exports are imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPass, loadCodes } from '../l2/run.mjs';
import { spent } from '../lib/budget.mjs';
import { splitGrouped, seededRng } from '../l3/split.mjs';
import { hasTracedAmend } from '../l2/converge.mjs';
import { parseProposalList, parseBallot } from '../l2/amend.mjs';

const tmp = (prefix = 'fix2-') => {
  try { return mkdtempSync(path.join(os.tmpdir(), prefix)); }
  catch (e) { if (e?.code !== 'EROFS' && e?.code !== 'EACCES') throw e; return mkdtempSync(path.join('/tmp', prefix)); }
};
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const CLASSIF_DIR = path.join(REPO_ROOT, 'tools', 'classif');

function saveEnv(keys) {
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  return saved;
}
function restoreEnv(saved) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
function withTempHome(fn) {
  return async () => {
    const home = tmp('fix2-home-');
    const saved = saveEnv(['CLASSIF_HOME', 'CLASSIF_SPLIT_FILE', 'CLASSIF_REPO', 'CLASSIF_EVAL_DIR', 'CLASSIF_TEST_QUOTA_WAIT_MS', 'CLASSIF_ROLE', 'CLASSIF_BLIND_KEY', 'CLASSIF_ACTOR', 'CLASSIF_ASTRA_AUTH_SRC']);
    process.env.CLASSIF_HOME = home;
    delete process.env.CLASSIF_SPLIT_FILE;
    delete process.env.CLASSIF_REPO;
    delete process.env.CLASSIF_EVAL_DIR;
    try { await fn(home); }
    finally { restoreEnv(saved); rmSync(home, { recursive: true, force: true }); }
  };
}

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

// §3b via the real pass CLI: an uncommitted split.json is refused.
// On bcb704ca5 the CLI checks existence only and proceeds to the todo error.
test('fix2 §3b: real pass CLI refuses an uncommitted split.json', withTempHome(async (home) => {
  const splitFile = path.join(CLASSIF_DIR, 'l3', 'manifests', 'split.json');
  const existed = existsSync(splitFile);
  const backup = existed ? readFileSync(splitFile, 'utf8') : null;
  try {
    mkdirSync(path.dirname(splitFile), { recursive: true });
    writeFileSync(splitFile, JSON.stringify({ halves: { tuning: ['x'], blind: ['y'] } }));
    const r = spawnSync('node', [path.join(CLASSIF_DIR, 'l2', 'run.mjs'), '--pass', '2', '--half', 'tuning'],
      { encoding: 'utf8', env: { ...process.env, CLASSIF_HOME: home } });
    assert.equal(r.status, 2, `CLI must refuse (exit 2), got ${r.status}: ${r.stderr}${r.stdout}`);
    assert.match(r.stderr, /not committed|differs from the committed/i, `refusal must name the commit, got: ${r.stderr}`);
  } finally {
    if (existed) writeFileSync(splitFile, backup);
    else if (existsSync(splitFile)) rmSync(splitFile);
  }
}));

// §7a via the real converge stop path: a gel-only round never unlocks the stop.
// On bcb704ca5 hasTracedAmend counts gel files, so the stop unlocks.
test('fix2 §7a: freeze-only amend round does not allow the stop', () => {
  const dir = tmp('fix2-amend-');
  const realDir = path.join(CLASSIF_DIR, 'l2', 'manifests');
  const realExisted = existsSync(realDir) ? readdirSync(realDir).filter((f) => /^amend-.+\.json$/.test(f)) : [];
  const tmpFile = path.join(dir, 'amend-G9.json');
  writeFileSync(tmpFile, JSON.stringify({ kind: 'guide-amendment', gel: true }));
  try {
    assert.equal(hasTracedAmend(dir), false, 'gel-only round is not a traced round');
    // Real repo dir must stay gel-free for the hermetic check below; a gel file there
    // must also read as no traced round on fixed code (true on bcb704ca5).
    const probe = path.join(realDir, 'amend-G9-FIX2-PROBE.json');
    let touched = false;
    try {
      mkdirSync(realDir, { recursive: true });
      writeFileSync(probe, JSON.stringify({ kind: 'guide-amendment', gel: true }));
      touched = true;
      assert.equal(hasTracedAmend(), false, 'real dir with only a gel file has no traced round');
    } finally {
      if (touched && existsSync(probe)) rmSync(probe);
    }
    assert.deepEqual(realExisted, existsSync(realDir) ? readdirSync(realDir).filter((f) => /^amend-.+\.json$/.test(f)) : []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
// proposal/vote payload in last-message.md. Split: temp committed split for new via
// CLASSIF_SPLIT_FILE/REPO + real uncommitted split for old (env ignored there).
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
  // Split fixtures: real uncommitted (old reads it, no git check) + temp committed (new via env).
  const realSplit = path.join(CLASSIF_DIR, 'l3', 'manifests', 'split.json');
  const realExisted = existsSync(realSplit);
  const realBackup = realExisted ? readFileSync(realSplit, 'utf8') : null;
  const tmpRepo = tmp('fix2-repo-');
  let fbMuse = null; let fbClaude = null; let fbCodex = null;
  try {
    mkdirSync(path.dirname(realSplit), { recursive: true });
    writeFileSync(realSplit, JSON.stringify({ halves: { tuning: items.map((i) => i.itemId), blind: [] } }));
    spawnSync('git', ['init', '-q'], { cwd: tmpRepo });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: tmpRepo });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: tmpRepo });
    const tmpSplit = path.join(tmpRepo, 'split.json');
    writeFileSync(tmpSplit, JSON.stringify({ halves: { tuning: items.map((i) => i.itemId), blind: [] } }));
    spawnSync('git', ['add', 'split.json'], { cwd: tmpRepo });
    spawnSync('git', ['commit', '-qm', 'split'], { cwd: tmpRepo });
    const savedSplit = process.env.CLASSIF_SPLIT_FILE;
    const savedRepo = process.env.CLASSIF_REPO;
    process.env.CLASSIF_SPLIT_FILE = tmpSplit;
    process.env.CLASSIF_REPO = tmpRepo;
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
    if (savedSplit === undefined) delete process.env.CLASSIF_SPLIT_FILE; else process.env.CLASSIF_SPLIT_FILE = savedSplit;
    if (savedRepo === undefined) delete process.env.CLASSIF_REPO; else process.env.CLASSIF_REPO = savedRepo;
  } finally {
    if (fbMuse) fbMuse.restore();
    if (fbClaude) fbClaude.restore();
    if (fbCodex) fbCodex.restore();
    if (realExisted) writeFileSync(realSplit, realBackup);
    else if (existsSync(realSplit)) rmSync(realSplit);
    rmSync(tmpRepo, { recursive: true, force: true });
    const out = path.join(home, 'l1', 'pack', 'guide-G9FIX2.md');
    if (existsSync(out)) rmSync(out);
    // Repo amend manifest written by amendMain (real CLASSIF_DIR): remove to keep the
    // worktree clean and later §7a/plan checks hermetic.
    const repoManifest = path.join(CLASSIF_DIR, 'l2', 'manifests', 'amend-G9FIX2.json');
    if (existsSync(repoManifest)) rmSync(repoManifest);
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
// which parseVibe extracts). On bcb704ca5 the failure is cached and never retried.
test('fix2 N4: real devMain retries failed rows on resume', withTempHome(async (home) => {
  await setupDev98(home, 3);
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
  const devManifestFile = path.join(CLASSIF_DIR, 'l4', 'manifests', 'series-98-dev.json');
  const devExisted = existsSync(devManifestFile);
  const devBackup = devExisted ? readFileSync(devManifestFile, 'utf8') : null;
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
  } finally {
    fb.restore();
    if (devExisted) writeFileSync(devManifestFile, devBackup);
    else if (existsSync(devManifestFile)) rmSync(devManifestFile);
  }
}));

// §9a via the real devMain (series 98, supports 1000/1000): 40 shown refs still indeterminate.
// On bcb704ca5 supports default to 30/30, so the verdict is pass, not indeterminate.
test('fix2 §9a: real devMain drives indeterminate from series supports', withTempHome(async (home) => {
  await setupDev98(home, 40);
  const inner = JSON.stringify({ verdict: 'pertinent', code: 'P-DENSITE' });
  const good = JSON.stringify([{ role: 'assistant', type: 'message', content: [{ type: 'text', text: inner }] }]);
  const fb = fakeBin('vibe', `printf '%s' '${good}'\nexit 0`);
  const devManifestFile = path.join(CLASSIF_DIR, 'l4', 'manifests', 'series-98-dev.json');
  const devExisted = existsSync(devManifestFile);
  const devBackup = devExisted ? readFileSync(devManifestFile, 'utf8') : null;
  try {
    const { main: devMain, EVAL_ROUTES } = await import('../l4/dev.mjs');
    const only = 'glm-5.3-low';
    const skip = EVAL_ROUTES.filter((r) => r !== only);
    const rep = await devMain(['--series', '98', '--deferred', skip.join(','), '--concurrency', '2']);
    const agg = rep.aggregates[only];
    assert.ok(agg, `aggregates must carry ${only}`);
    assert.equal(agg.verdict, 'indeterminate', `40 shown refs with supports 1000 must be indeterminate, got ${agg.verdict} ${JSON.stringify(agg.indeterminate)}`);
    assert.deepEqual(agg.indeterminate, { recall: true, precision: true });
  } finally {
    fb.restore();
    if (devExisted) writeFileSync(devManifestFile, devBackup);
    else if (existsSync(devManifestFile)) rmSync(devManifestFile);
  }
}));

// N2 via the real blindMain (series 98): completed S113 routes are skipped — no second
// guard failure, no eval reopen. All blind + S113 done upfront, so no seat call and no
// sealed eval open on fixed code. On bcb704ca5 there is no S113 skip: the re-run hits
// assertEvalRunAllowed and throws (no crash-proof series).
test('fix2 N2: real blindMain resumes completed S113 routes', withTempHome(async (home) => {
  const { sha256 } = await import('../lib/render.mjs');
  const { buildFingerprints } = await import('../lib/fingerprint.mjs');
  const { newKey } = await import('./fixture.mjs');
  const { ROUTES } = await import('../run-seat.mjs');
  const { EVAL_ROUTES } = await import('../l4/dev.mjs');
  const only = 'glm-5.3-low';
  const { model, effort } = ROUTES[only];
  // Corpus: 2 blind items.
  const blindRows = [
    { itemId: 'b98-1', kind: 'signal', code: 'P-DENSITE', verdict: 'pertinent', status: 'resolved' },
    { itemId: 'b98-2', kind: 'signal', code: 'P-DENSITE', verdict: 'pertinent', status: 'resolved' },
  ];
  const corpus = blindRows.map((r) => ({ itemId: r.itemId, kind: 'signal', anchor: { id: `n-${r.itemId}`, citySlug: 'v' }, input: `texte blind ${r.itemId} six logements zone H-9.` }));
  mkdirSync(path.join(home, 'l0'), { recursive: true });
  const cbody = `${corpus.map((i) => JSON.stringify(i)).join('\n')}\n`;
  writeFileSync(path.join(home, 'l0', 'dev-items.jsonl'), cbody);
  writeFileSync(path.join(home, 'l0', 'dev-items.expect.json'), JSON.stringify({ count: corpus.length, sha256: sha256(cbody) }));
  mkdirSync(path.join(home, 'guard'), { recursive: true });
  writeFileSync(path.join(home, 'guard', 'salt'), 'fix2-salt\n');
  writeFileSync(path.join(home, 'guard', 'fingerprints.json'), JSON.stringify(buildFingerprints('fix2-salt', { nodeIds: [], docShas: [], citySlugs: [], bylaws: [], inputs: ['scelle fictif blind98'] })));
  // Blind seal in the temp home with a test key.
  const key = newKey().toString('base64');
  const savedRole = process.env.CLASSIF_ROLE;
  const savedKey = process.env.CLASSIF_BLIND_KEY;
  const savedActor = process.env.CLASSIF_ACTOR;
  const savedEvalDir = process.env.CLASSIF_EVAL_DIR;
  process.env.CLASSIF_ROLE = 'test-executor';
  process.env.CLASSIF_BLIND_KEY = key;
  process.env.CLASSIF_ACTOR = 'fix2-test';
  const frozen = readFileSync(path.join(CLASSIF_DIR, 'l4', 'prompts', 'P98.md'), 'utf8');
  const promptSha = sha256(frozen);
  const { sealBlindSet } = await import('../lib/blind.mjs');
  const seal = sealBlindSet(blindRows, { home, env: process.env });
  // Repo manifests (temporary, restored after): dev manifest + reference-d with the seal sha.
  const devManifestFile = path.join(CLASSIF_DIR, 'l4', 'manifests', 'series-98-dev.json');
  const refManifestFile = path.join(CLASSIF_DIR, 'l3', 'manifests', 'reference-d.json');
  const blindManifestFile = path.join(CLASSIF_DIR, 'l4', 'manifests', 'series-98-blind.json');
  const savedDev = existsSync(devManifestFile) ? readFileSync(devManifestFile, 'utf8') : null;
  const savedRef = existsSync(refManifestFile) ? readFileSync(refManifestFile, 'utf8') : null;
  const savedBlind = existsSync(blindManifestFile) ? readFileSync(blindManifestFile, 'utf8') : null;
  const evalDir = tmp('fix2-eval-');
  process.env.CLASSIF_EVAL_DIR = evalDir;
  try {
    mkdirSync(path.join(CLASSIF_DIR, 'l4', 'manifests'), { recursive: true });
    mkdirSync(path.join(CLASSIF_DIR, 'l3', 'manifests'), { recursive: true });
    writeFileSync(devManifestFile, JSON.stringify({ kind: 'l4-dev', series: '98', promptSha256: promptSha, routes: [only] }));
    writeFileSync(refManifestFile, JSON.stringify({ hashes: { blindPlain: seal.plainSha256, blindSealed: seal.sealedSha256 } }));
    // Private aggregates: blind route done + s113 done, both verified at the prompt sha.
    const { blindDir } = await import('../lib/blind.mjs');
    const { privateDir } = await import('../lib/paths.mjs');
    const outDir = privateDir(blindDir(home));
    const stats = { scored: 2, refShown: 2, predShown: 2, recall: 1, recallLB: 0.9, precision: 1, precisionLB: 0.9, indeterminate: { recall: true, precision: true } };
    writeFileSync(path.join(outDir, `series-98-${only}.json`),
      JSON.stringify({ series: '98', route: only, model, effort, promptSha256: promptSha, stats, withUnresolved: stats, failures: 0, verdict: 'indeterminate' }));
    const { audit } = await import('../lib/blind.mjs');
    audit({ action: 'blind-run', purpose: 'l4-blind-s98', promptSha256: promptSha, model, effort, items: 2, failures: 0 }, { home, env: process.env });
    const s113agg = { scored: 1, recall: 1, indeterminate: {} };
    writeFileSync(path.join(outDir, `s113-series-98-${only}.json`),
      JSON.stringify({ series: '98', route: only, promptSha256: promptSha, stats: s113agg, s113: { ...s113agg, flag: 'golden-exposed' } }));
    writeFileSync(path.join(evalDir, 'access-log.jsonl'),
      `${JSON.stringify({ at: new Date().toISOString(), actor: 'fix2-test', role: 'test-executor', action: 'eval-run', purpose: 'l4-s113-s98', promptSha256: promptSha, model, effort, items: 1 })}\n`);
    const callsBefore = callsLines(home).length;
    const { main: blindMain } = await import('../l4/blind.mjs');
    const skip = EVAL_ROUTES.filter((r) => r !== only);
    const rep = await blindMain(['--series', '98', '--deferred', skip.join(','), '--concurrency', '1']);
    assert.ok(rep.aggregatesSha256, 'blind resume must return a manifest');
    assert.equal(callsLines(home).length, callsBefore, 'resumed S113 must make no new seat call');
  } finally {
    if (savedRole === undefined) delete process.env.CLASSIF_ROLE; else process.env.CLASSIF_ROLE = savedRole;
    if (savedKey === undefined) delete process.env.CLASSIF_BLIND_KEY; else process.env.CLASSIF_BLIND_KEY = savedKey;
    if (savedActor === undefined) delete process.env.CLASSIF_ACTOR; else process.env.CLASSIF_ACTOR = savedActor;
    if (savedEvalDir === undefined) delete process.env.CLASSIF_EVAL_DIR; else process.env.CLASSIF_EVAL_DIR = savedEvalDir;
    if (savedDev === null) { if (existsSync(devManifestFile)) rmSync(devManifestFile); } else writeFileSync(devManifestFile, savedDev);
    if (savedRef === null) { if (existsSync(refManifestFile)) rmSync(refManifestFile); } else writeFileSync(refManifestFile, savedRef);
    if (savedBlind === null) { if (existsSync(blindManifestFile)) rmSync(blindManifestFile); } else writeFileSync(blindManifestFile, savedBlind);
    rmSync(evalDir, { recursive: true, force: true });
  }
}));
