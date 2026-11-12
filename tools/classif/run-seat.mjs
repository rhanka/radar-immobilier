// Seat-only model routes (port of origin/feat/oracle-c-draft docs/reviews/oracle-c-draft/scripts/
// lib/models.mjs). Every child process runs in a fresh EMPTY working directory, with an environment
// scrubbed of provider keys / base URLs / cloud variables, tools and MCP disabled where the CLI
// allows it, so the model sees only the prompt. No API key is ever passed.
import { spawn } from 'node:child_process';
import { clearTimeout, setTimeout } from 'node:timers';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { ALIASES, LEVELS, vibeHome } from './lib/vibe-home.mjs';
import { classifHome, testOnlyEnv } from './lib/paths.mjs';
import { privateDir } from './lib/paths.mjs';
import { extractCodexRateLimits } from './lib/codex-quota.mjs';

const SCRUB = /(_API_KEY|_AUTH_TOKEN|_API_BASE|_BASE_URL|_SECRET_KEY|_ACCESS_KEY)$|^(ANTHROPIC_|OPENAI_|GEMINI_|CLAUDE_CODE_USE_|AWS_|GOOGLE_CLOUD_|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_GENAI_USE_VERTEXAI|VERTEX|SCRAPE_S3_|REFERENCE_C_KEY|CLASSIF_EVAL_KEY|CLASSIF_BLIND_KEY|MISTRAL_|VIBE_ACTIVE_MODEL)/;
/**
 * Seat environment: the process env scrubbed of provider keys and cloud variables, of every
 * CLASSIF_* variable and of every variable whose value carries the $CLASSIF_HOME path (review
 * GEPA R4: a seat that can run a command must not learn where the pilot files are), plus the
 * route's own `extra` variables.
 */
export function seatEnv(extra = {}, env = process.env) {
  const home = classifHome(env);
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (SCRUB.test(k) || /^CLASSIF_/.test(k) || (typeof v === 'string' && v.includes(home))) continue;
    out[k] = v;
  }
  return { ...out, ...extra };
}

const lastJson = (stdout) => {
  try { return JSON.parse(stdout); } catch { /* fallthrough */ }
  const lines = stdout.trim().split('\n').reverse();
  for (const l of lines) { try { return JSON.parse(l); } catch { /* next */ } }
  return null;
};

export const NEUTRAL_SYSTEM = 'You are a careful annotator. Follow the user instructions exactly and answer only in the requested format.';

/** Route table: label → { family, model, effort, build(dir, promptFile, prompt) → {cmd, args, env, stdin}, parse(stdout, dir) }. */
export const ROUTES = {
  'muse-wonder-max': {
    family: 'Muse Wonder', model: 'muse-wonder-1.0', effort: 'max', route: 'muse exec --prompt-file, preset empty, no web tools, no session log',
    build: (dir, file) => ({ cmd: 'muse', args: ['exec', '--model', 'muse-wonder-1.0', '--reasoning-effort', 'max', '--preset', 'empty', '--prompt-file', file, '--json',
      '--disable-web-tools', '--disable-reminders', '--disable-request-user-input', '--no-foreign-personal-context', '--no-session-log', '--workspace', dir] }),
    parse: parseMuse,
  },
  ...Object.fromEntries(['low', 'medium'].map((e) => [`muse-spark-1.3-${e}`, {
    family: 'Muse 1.3', model: 'muse-spark-1.3', effort: e, route: 'muse exec --prompt-file, preset empty, no web tools, no session log',
    build: (dir, file) => ({ cmd: 'muse', args: ['exec', '--model', 'muse-spark-1.3', '--reasoning-effort', e, '--preset', 'empty', '--prompt-file', file, '--json',
      '--disable-web-tools', '--disable-reminders', '--disable-request-user-input', '--no-foreign-personal-context', '--no-session-log', '--workspace', dir] }),
    parse: parseMuse,
  }])),
  'gemini-4-argon-low': {
    family: 'Gemini 4 Argon', model: 'gemini-4-argon-low', effort: 'low', route: 'agy --print= with stream-json stdin input, slash commands disabled, empty cwd',
    build: (_dir, _file, prompt) => ({ cmd: 'agy', args: ['--model', 'gemini-4-argon-low', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--disable-slash-commands', '--print='], stdin: `${JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } })}\n` }),
    parse: parseAgyStream,
  },
  // agy: prompt on stdin as one stream-json "user" event (no 128 KB argument limit, L0 open point).
  ...Object.fromEntries(['high', 'medium', 'low'].map((e) => [`gemini-4-argon-${e}`, {
    family: 'Gemini 4 Argon', model: `gemini-4-argon-${e}`, effort: e, route: 'agy --print= with stream-json stdin input, slash commands disabled, empty cwd',
    build: (_dir, _file, prompt) => ({ cmd: 'agy', args: ['--model', `gemini-4-argon-${e}`, '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--disable-slash-commands', '--print='], stdin: `${JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } })}\n` }),
    parse: parseAgyStream,
  }])),
  ...Object.fromEntries(['max', 'medium', 'low'].map((e) => [`opus-5.5-${e}`, {
    family: 'Opus 5.5', model: 'claude-opus-5-5', effort: e, route: 'isolated claude -p: no tools, no CLAUDE.md (CLAUDE_CODE_DISABLE_CLAUDE_MDS=1), project settings only, neutral system prompt, empty MCP config, no session persistence, empty cwd',
    build: (_dir, _file, prompt) => ({ cmd: 'claude', args: ['-p', '--model', 'claude-opus-5-5', '--effort', e, '--output-format', 'json',
      '--tools', '', '--setting-sources', 'project', '--no-session-persistence', '--system-prompt', NEUTRAL_SYSTEM,
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], stdin: prompt, env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1' } }),
    parse: (stdout) => { const j = lastJson(stdout); return { text: j?.result ?? '', usage: j?.usage ?? null, costUsdApiEquivalent: j?.total_cost_usd ?? null, isError: j?.is_error ?? false,
      errorEnvelope: j?.is_error ? String(j?.result ?? j?.error ?? '') : '' }; },
  }])),
  // Astra (ChatGPT seat, plan v3 owner decision 04/11): conductor-verified route
  // `codex exec -m gpt-6-astra -c model_reasoning_effort=max -s read-only`, empty cwd, scrubbed
  // env, isolated CODEX_HOME ($CLASSIF_HOME/seat-homes/astra, mode 700, config with NO
  // mcp_servers, auth copied from ~/.codex/auth.json). Machine flags added for parsing only:
  // `--json` (JSONL events on stdout) and `-o last-message.md` (the model's final message on
  // disk); the prompt goes through stdin (`-`, no 128 KB argument limit).
  // `--skip-git-repo-check` allows the empty non-repo cwd. No `--ephemeral`: the quota
  // (`rate_limits`) is only written to the session file, which callSeat reads (rate_limits keys
  // only) then DELETES after every call (it holds the prompt). codex reads CODEX_HOME (verified: unknown CODEX_HOME warns, isolated
  // home with copied auth.json connects, `codex doctor` auth mode chatgpt).
  'astra-max': {
    family: 'Astra', model: 'gpt-6-astra', effort: 'max', route: 'codex exec -m gpt-6-astra -c model_reasoning_effort=max -s read-only, isolated CODEX_HOME, empty cwd, scrubbed env (--json + -o last-message.md for parsing, prompt on stdin)',
    build: (dir, _file, prompt) => ({ cmd: 'codex', args: ['exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort=max', '-s', 'read-only',
      '--skip-git-repo-check', '--json', '-o', path.join(dir, 'last-message.md'), '-'], stdin: prompt,
      env: { CODEX_HOME: ensureAstraHome() } }),
    parse: parseCodex,
  },
  // ChatGPT evaluation seats on the same isolated codex route as astra-max — own CODEX_HOME per
  // seat (config with NO mcp_servers, copied auth), empty cwd, scrubbed env, read-only sandbox,
  // session file read for the quota then deleted, --json + -o last-message.md for parsing, prompt
  // on stdin, parseCodex (fail-closed tools). sol-6.1-low and luna-6-low: GEPA method (owner,
  // sol not luna); sol-6.1-medium, astra-low and astra-medium: owner 12/11, P0 evaluated on Astra
  // and Sol in low and medium (Astra was only an annotator and the GEPA mutator before).
  ...Object.fromEntries([
    ['sol-6.1-low', 'Sol 6.1', 'gpt-6.1-sol', 'low'],
    ['sol-6.1-medium', 'Sol 6.1', 'gpt-6.1-sol', 'medium'],
    ['luna-6-low', 'Luna 6', 'gpt-6-luna', 'low'],
    ['astra-low', 'Astra', 'gpt-6-astra', 'low'],
    ['astra-medium', 'Astra', 'gpt-6-astra', 'medium'],
  ].map(([label, family, model, effort]) => [label, {
    family, model, effort, route: `codex exec -m ${model} -c model_reasoning_effort=${effort} -s read-only, isolated CODEX_HOME, empty cwd, scrubbed env (--json + -o last-message.md for parsing, prompt on stdin)`,
    build: (dir, _file, prompt) => ({ cmd: 'codex', args: ['exec', '-m', model, '-c', `model_reasoning_effort=${effort}`, '-s', 'read-only',
      '--skip-git-repo-check', '--json', '-o', path.join(dir, 'last-message.md'), '-'], stdin: prompt,
      env: { CODEX_HOME: ensureCodexHome(label, { model, effort }) } }),
    parse: parseCodex,
  }])),
  // vibe: per-effort VIBE_HOME (lib/vibe-home.mjs) + classification alias; L0 aliases kept for reference.
  ...Object.fromEntries([
    ['glm-5.3', 'glm-5-3', 'GLM 5.3', null, 'config (high)'],
    ['mistral-large-4', 'mistral-large-4', 'Mistral Large 4', null, 'config (high)'],
    ...LEVELS.flatMap((lv) => [[`glm-5.3-${lv}`, ALIASES.glm, 'GLM 5.3', lv, lv], [`mistral-large-4-${lv}`, ALIASES.mistral, 'Mistral Large 4', lv, lv]]),
  ].map(([label, alias, family, level, effort]) => [label, {
    family, model: alias, effort, route: `vibe --prompt-file --output json --max-price --output-dir (VIBE_ACTIVE_MODEL=${alias}${level ? `, VIBE_HOME=<classif>/vibe/${level}` : ''}), empty cwd`,
    build: (dir, file) => ({ cmd: 'vibe', args: ['--prompt-file', file, '--output', 'json', '--max-price', '0.50', '--max-turns', '1', '--output-dir', path.join(dir, 'export'), '--trust', '--workdir', dir],
      env: { VIBE_ACTIVE_MODEL: alias, ...(level ? { VIBE_HOME: vibeHome(classifHome(), level) } : {}) } }),
    parse: parseVibe,
  }])),
};

// Isolated CODEX_HOME per codex seat (review §10, review GEPA R4): ~/.local/share/
// radar-classif-seats/<seat>/ (mode 700), OUTSIDE $CLASSIF_HOME so the CODEX_HOME value a seat
// sees never points at the pilot files. Holds a config with NO mcp_servers and the auth file
// (mode 600). codex reads CODEX_HOME (verified 2026-11-05: unknown CODEX_HOME warns, isolated
// home with copied auth connects, doctor reports auth mode chatgpt), so the seat never sees the
// user's ~/.codex/config.toml MCP servers. The former homes ($CLASSIF_HOME/seat-homes/<dir>,
// astra in 'astra') are only read once, to migrate their auth.json.
const LEGACY_CODEX_HOME_DIRS = { 'astra-max': 'astra' };

/**
 * Root of the isolated codex homes. The CLASSIF_SEAT_HOMES hook is test-only, and REQUIRED in
 * test mode (fail closed: a hermetic test never writes the real seat homes).
 */
export function seatHomesRoot(env = process.env) {
  const o = testOnlyEnv(env, 'CLASSIF_SEAT_HOMES');
  if (o === undefined && env.CLASSIF_TEST_MODE === '1') throw new Error('test mode requires CLASSIF_SEAT_HOMES (never the real seat homes)');
  return path.resolve(o ?? path.join(os.homedir(), '.local', 'share', 'radar-classif-seats'));
}

export function codexHomeDir(seat, root = seatHomesRoot()) {
  return path.join(root, seat);
}

export function legacyCodexHomeDir(seat, home = classifHome()) {
  return path.join(home, 'seat-homes', LEGACY_CODEX_HOME_DIRS[seat] ?? seat);
}

export function astraCodexHomeDir(root = seatHomesRoot()) {
  return codexHomeDir('astra-max', root);
}

const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// ---- codex session files (quota source, review GEPA quota guard) ----
// Without --ephemeral, codex writes $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<thread id>.jsonl.
// It holds the prompt (item text, blind items included): callSeat reads its rate_limits lines
// only, then deletes it and its empty directories in a finally, success or failure.
export const CODEX_SESSION_STALE_MS = 2 * 3600 * 1000;

function listSessionFiles(root) {
  const out = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root);
  return out;
}

function pruneEmptyDirs(root) {
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory()) walk(path.join(d, e.name));
    if (d !== root) { try { fs.rmdirSync(d); } catch { /* not empty */ } }
  };
  walk(root);
}

/** Session files currently under a codex home (snapshot before a call). */
export const codexSessionFiles = (codexHome) => (codexHome ? listSessionFiles(path.join(codexHome, 'sessions')) : []);

/** Thread id of a codex --json stdout (thread.started), or null. */
export function codexThreadId(stdout) {
  for (const line of String(stdout ?? '').split('\n')) {
    if (!line.includes('thread.started')) continue;
    try { const e = JSON.parse(line); if (e?.type === 'thread.started') return e.thread_id ?? e.session_id ?? e.id ?? null; } catch { /* next */ }
  }
  return null;
}

/**
 * The session file(s) of one call — named after its thread id, else the files that appeared
 * since `before` — are read for rate_limits only, then deleted with their empty directories
 * (finally: even when reading fails). Returns the last rate_limits found, or null.
 */
export function takeCodexSession({ codexHome, stdout, before = new Set() }) {
  if (!codexHome) return null;
  const root = path.join(codexHome, 'sessions');
  if (!fs.existsSync(root)) return null;
  const tid = codexThreadId(stdout);
  const files = listSessionFiles(root).filter((f) => (tid ? path.basename(f).includes(tid) : !before.has(f)));
  let rateLimits = null;
  try {
    for (const f of files) {
      try { rateLimits = extractCodexRateLimits(fs.readFileSync(f, 'utf8')) ?? rateLimits; } catch { /* unreadable: still deleted */ }
    }
  } finally {
    for (const f of files) fs.rmSync(f, { force: true });
    pruneEmptyDirs(root);
  }
  return rateLimits;
}

/** Deletes session files left by a killed process (older than CODEX_SESSION_STALE_MS). */
export function sweepStaleCodexSessions(codexHome, now = Date.now()) {
  const root = path.join(codexHome, 'sessions');
  for (const f of listSessionFiles(root)) {
    try { if (now - fs.statSync(f).mtimeMs > CODEX_SESSION_STALE_MS) fs.rmSync(f, { force: true }); } catch { /* gone */ }
  }
  if (fs.existsSync(root)) pruneEmptyDirs(root);
}

/** Codex seats (ChatGPT quota shared with the production immo detection): astra-max, astra-low/medium, sol-6.1-low/medium, luna-6-low. */
export const isCodexSeat = (label) => ROUTES[label]?.parse === parseCodex;

/** Exact command that refreshes a codex seat auth from ~/.codex/auth.json (review GEPA R5). */
export const seatAuthRefreshCommand = (seat) => `make classif-seat-auth-refresh SEAT=${seat} ENV=preprod`;

/**
 * Tool features switched off in every isolated codex config (`[features]`, review GEPA B1c).
 * Checked against `codex features list` (codex-cli 0.163.0, isolated CODEX_HOME, no model
 * call): every name below reads `false` once disabled EXCEPT `unified_exec`, which codex
 * keeps enabled whatever the config says. Disabling tools by config is therefore NOT a proven
 * barrier: the binding barrier stays the parse-time rejection — any tool, command, file or
 * unknown event in the --json stream makes the call a failure (never an accepted answer, never
 * cached), plus the read-only sandbox and an empty cwd outside $CLASSIF_HOME.
 */
export const CODEX_DISABLED_FEATURES = ['shell_tool', 'unified_exec', 'unified_exec_tty', 'shell_snapshot', 'apps', 'plugins', 'remote_plugin',
  'plugin_sharing', 'multi_agent', 'image_generation', 'view_image', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
  'computer_use', 'code_mode_host', 'code_mode_interrupt', 'skill_search', 'skill_mcp_dependency_install', 'sleep_tool', 'hooks',
  'tool_suggest', 'tool_call_mcp_elicitation', 'goals', 'in_app_browser', 'in_app_local_automation', 'workspace_dependencies', 'worktrees'];

/** Isolated codex config of one seat: NO mcp_servers, web search disabled, read-only sandbox, tool features off. */
export function codexIsolatedConfig({ name, model, effort }) {
  return `# Classification pilot — isolated ${name} seat (review §10).
# NO mcp_servers section: any MCP exposure fails the call (parseCodex counts it).
# Auth comes from auth.json copied from ~/.codex/auth.json (never committed).
model = "${model}"
model_reasoning_effort = "${effort}"
web_search = "disabled"
approval_policy = "never"
sandbox_mode = "read-only"

[features]
${CODEX_DISABLED_FEATURES.map((f) => `${f} = false`).join('\n')}
`;
}

/** Atomic private write: temp file in the same directory, then rename (no torn read). */
function atomicPrivateWrite(file, data) {
  const tmpFile = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpFile, data, { mode: 0o600 });
  fs.chmodSync(tmpFile, 0o600);
  fs.renameSync(tmpFile, file);
}

/** Seat homes already prepared by this process (review GEPA M2): one preparation per run and seat. */
const PREPARED_CODEX_HOMES = new Set();

export const ASTRA_ISOLATED_CONFIG = codexIsolatedConfig({ name: 'Astra', model: 'gpt-6-astra', effort: 'max' });

export function ensureAstraHome(opts = {}) {
  return ensureCodexHome('astra-max', { model: 'gpt-6-astra', effort: 'max', name: 'Astra', ...opts });
}

/**
 * Prepares the isolated home of one codex seat ONCE per process (review GEPA M2): the config is
 * written atomically (temp file + rename), the auth file is copied atomically only when the
 * seat home has none — never again during the run, so a token codex refreshed inside the seat
 * home is never overwritten by an older ~/.codex/auth.json, and 2 calls in flight never see a
 * torn file. Later calls of the same process return the prepared directory untouched.
 * A missing auth is taken from the former home inside $CLASSIF_HOME when it holds one
 * (migration), else from ~/.codex/auth.json. Refused when the home would sit in $CLASSIF_HOME.
 * The test-only CLASSIF_ASTRA_AUTH_SRC hook (CLASSIF_TEST_MODE=1) serves every codex seat.
 */
export function ensureCodexHome(seat, { model, effort, name = seat, home = classifHome(), root = seatHomesRoot(), authSrc = testOnlyEnv(process.env, 'CLASSIF_ASTRA_AUTH_SRC') ?? null } = {}) {
  const dir = codexHomeDir(seat, root);
  if (PREPARED_CODEX_HOMES.has(dir)) return dir;
  if (isInside(dir, home)) throw new Error(`${seat} isolation refused: seat home ${dir} is inside CLASSIF_HOME`);
  privateDir(root);
  privateDir(dir);
  atomicPrivateWrite(path.join(dir, 'config.toml'), codexIsolatedConfig({ name, model, effort }));
  // Review D1/D2: hermetic tests set CLASSIF_ASTRA_AUTH_SRC to a fake auth file in
  // test mode (CLASSIF_TEST_MODE=1) — production refuses the hook, the real
  // ~/.codex/auth.json is never read in tests.
  const src = authSrc ?? path.join(os.homedir(), '.codex', 'auth.json');
  const dst = path.join(dir, 'auth.json');
  if (!fs.existsSync(dst)) {
    const legacy = path.join(legacyCodexHomeDir(seat, home), 'auth.json');
    const from = fs.existsSync(legacy) ? legacy : src;
    if (!from || !fs.existsSync(from)) throw new Error(`${seat === 'astra-max' ? 'astra' : seat} isolation refused: no auth to copy (${src} absent and ${dst} absent)`);
    atomicPrivateWrite(dst, fs.readFileSync(from));
  }
  sweepStaleCodexSessions(dir);
  PREPARED_CODEX_HOMES.add(dir);
  return dir;
}

/**
 * `make classif-seat-auth-refresh SEAT=<seat>`: atomically replaces the auth of one codex seat
 * home with ~/.codex/auth.json (after a new login of the owner, or a stale or revoked seat
 * token). A running process reads it at its next call (one codex process per call).
 */
export function refreshCodexAuth(seat, { root = seatHomesRoot(), home = classifHome(), authSrc = testOnlyEnv(process.env, 'CLASSIF_ASTRA_AUTH_SRC') ?? null } = {}) {
  if (!ROUTES[seat] || ROUTES[seat].parse !== parseCodex) throw new Error(`seat auth refresh refused: ${seat} is not a codex seat (${Object.keys(ROUTES).filter((r) => ROUTES[r].parse === parseCodex).join(',')})`);
  const dir = codexHomeDir(seat, root);
  if (isInside(dir, home)) throw new Error(`seat auth refresh refused: seat home ${dir} is inside CLASSIF_HOME`);
  const src = authSrc ?? path.join(os.homedir(), '.codex', 'auth.json');
  if (!fs.existsSync(src)) throw new Error(`seat auth refresh refused: ${src} absent (log in with codex first)`);
  privateDir(root);
  privateDir(dir);
  atomicPrivateWrite(path.join(dir, 'auth.json'), fs.readFileSync(src));
  return dir;
}

/**
 * A failed call whose output reads as a quota or rate limit (HTTP 402/429, quota, rate limit,
 * budget exhausted): retried with a bounded backoff by GEPA before it counts as a failure.
 */
/**
 * Error messages of the codex CLI envelope only (turn.failed / error events), never the model's
 * answer text.
 */
export function codexErrorEnvelope(stdout) {
  const out = [];
  for (const line of String(stdout ?? '').split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e?.type === 'turn.failed' || e?.type === 'error') out.push(String(e?.error?.message ?? e?.message ?? JSON.stringify(e?.error ?? '')));
  }
  return out.join('\n');
}

/** Provider / infrastructure error sources of a failed call: stderr and the CLI error envelope, never the answer. */
const errorSources = (r) => `${r?.stderrTail ?? ''}\n${r?.errorEnvelope ?? ''}`;

/** vibe stopped on its own per-call price ceiling (--max-price): an answer failure, never a quota (review GEPA N6). */
export function looksLikeMaxPrice(r) {
  if (!r || r.code === 0) return false;
  return /max[-_ ]?price|maximum price|price (?:limit|ceiling|cap)|cost (?:limit|ceiling|cap)/i.test(errorSources(r));
}

/**
 * A failed call whose provider or infrastructure error reads as a quota or rate limit (HTTP
 * 402/429, quota, rate limit, too many requests, insufficient quota/credit/balance), read from
 * stderr and the CLI error envelope only — never the model's answer (review GEPA N6). A vibe
 * --max-price stop is never a quota. Retried with a bounded backoff by GEPA before it counts.
 */
export function looksLikeQuotaFailure(r) {
  if (!r || r.code === 0 || looksLikeMaxPrice(r)) return false;
  return /\b(?:402|429)\b|quota|rate[ _-]?limit|too many requests|insufficient[ _](?:quota|credit|balance)/i.test(errorSources(r));
}

/** A failed codex call whose output reads as an authentication failure (stale or revoked seat token). */
export function looksLikeAuthFailure(code, text) {
  return code !== 0 && /\b401\b|unauthori[sz]ed|authentication|auth(?:orization)? (?:error|failed|expired)|token (?:expired|is expired|refresh)|refresh[_ ]token|not logged in|log ?in again|codex login/i.test(String(text ?? ''));
}

/**
 * Base of the per-call seat directory of a codex seat (review GEPA B1b): the system temp dir,
 * never $CLASSIF_HOME (a relative read from the cwd must not reach the private pilot files).
 * Fails closed when the temp dir sits inside $CLASSIF_HOME. callSeat creates one mkdtemp
 * directory per call under it (empty work cwd) and removes it when the call ends.
 */
export function codexSeatBase(env = process.env) {
  const base = path.resolve(os.tmpdir());
  const rel = path.relative(classifHome(env), base);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error(`codex seat refused: temp dir ${base} is inside CLASSIF_HOME (set TMPDIR outside it)`);
  }
  return base;
}

// codex exec --json: one JSON event per line; the model's final message is also written to
// last-message.md (-o). Usage rides on turn completion events. Fail-closed tool accounting
// (review §10): every tool/command/MCP/web-search/file event counts, and any UNKNOWN event
// or item type counts too — every caller treats toolEvents > 0 as a FAILED call (L2 nulls the
// vote, L4 dev/blind/S113/GEPA count it failed and never cache it, the optimiser refuses it).
export const CODEX_KNOWN_EVENT_TYPES = new Set([
  'thread.started', 'turn.started', 'turn.completed', 'turn.failed',
  'item.started', 'item.updated', 'item.completed',
]);

// Only these item types are benign model output. Everything else (command_execution,
// file_change, mcp_tool_call, collab_tool_call, web_search, todo_list, plan_update,
// error items, or any unknown type) is a tool event.
export const CODEX_BENIGN_ITEM_TYPES = new Set(['agent_message', 'reasoning']);

/**
 * `error` items codex emits on EVERY call of the isolated seats, unrelated to tools (the tool
 * features are disabled): benign by exact notice only — any other error item still counts.
 */
export const CODEX_BENIGN_ERROR_NOTICES = [/^Code Mode is unavailable because code-mode host is disabled/,
  // Transport fallback (observed 12/11 on astra-low and sol-6.1-medium, answered calls): the
  // ChatGPT WebSocket refuses (403), codex falls back to HTTPS — a CLI transport notice, no tool.
  /^Falling back from WebSockets to HTTPS transport\. /];
const benignErrorItem = (item) => item?.type === 'error' && CODEX_BENIGN_ERROR_NOTICES.some((re) => re.test(String(item.message ?? item.text ?? '')));

/**
 * Top-level `error` events of the codex CLI that only report a transport reconnection (`Reconnecting...
 * n/m (...)`, emitted before the WebSocket to HTTPS fallback): benign by exact prefix only — any
 * other top-level error event still counts (fail closed). Never model text: the model's answer
 * rides in agent_message items.
 */
export const CODEX_BENIGN_TOP_ERRORS = [/^Reconnecting\.\.\. \d+\/\d+ \(/];
const benignTopError = (e) => e?.type === 'error' && CODEX_BENIGN_TOP_ERRORS.some((re) => re.test(String(e.message ?? e.error?.message ?? '')));

const CODEX_TOOL_KEY = /(tool_call|toolcall|function_call|exec_command|shell_command|command_execution|file_change|mcp|web_search|websearch)/i;

export function countCodexToolEvents(stdout) {
  let toolEvents = 0;
  const unknownTypes = [];
  // Diagnostic (owner 12/11): kind of every counted event — event and item types only, never
  // a message, a command or any model text — so an intermittent refusal can be explained.
  const toolKinds = {};
  const kind = (k) => { toolKinds[k] = (toolKinds[k] ?? 0) + 1; };
  for (const line of String(stdout ?? '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    // Review §10: fail closed on form — a non-JSON line is not a benign event.
    try { e = JSON.parse(line); } catch { toolEvents++; unknownTypes.push('<non-json>'); kind('<non-json>'); continue; }
    const type = e?.type ?? e?.event ?? null;
    if (!type || typeof type !== 'string') { toolEvents++; unknownTypes.push('<missing-type>'); kind('<missing-type>'); continue; }
    // Quota metering (`token_count`, carrying `rate_limits`) is benign; any other unknown type still counts.
    if (type === 'token_count' || (type === 'event_msg' && e?.payload?.type === 'token_count')) continue;
    if (benignTopError(e)) continue;
    if (!CODEX_KNOWN_EVENT_TYPES.has(type)) { toolEvents++; unknownTypes.push(type); kind(type); continue; }
    if (type.startsWith('item.')) {
      const item = e?.item ?? e?.data ?? e;
      const itype = item?.type ?? null;
      if (!itype || typeof itype !== 'string') { toolEvents++; unknownTypes.push(`${type}:<missing-item-type>`); kind(`${type}:<missing-item-type>`); continue; }
      if (benignErrorItem(item)) continue;
      if (!CODEX_BENIGN_ITEM_TYPES.has(itype)) { toolEvents++; kind(`${type}:${itype}`); continue; }
      // Fail closed on a tool payload nested inside a benign item (keys only, never the
      // model text: the word "tool" in prose must not count).
      if (CODEX_TOOL_KEY.test(JSON.stringify(Object.keys(item)))) { toolEvents++; kind(`${type}:${itype}:tool-key`); }
    }
  }
  return { toolEvents, unknownTypes, toolKinds };
}

export function parseCodex(stdout, dir) {
  let usage = null;
  let text = '';
  try {
    const last = fs.readFileSync(path.join(dir, 'last-message.md'), 'utf8').trim();
    if (last) text = last;
  } catch { /* file absent: fall back to the events */ }
  // File absent: the last completed agent_message is the answer — before the generic walk,
  // so a reasoning item's text is never taken as the model's answer.
  if (!text) {
    for (const line of String(stdout ?? '').split('\n')) {
      try {
        const e = JSON.parse(line);
        if (e?.type === 'item.completed' && e?.item?.type === 'agent_message' && typeof e.item.text === 'string' && e.item.text.trim()) text = e.item.text;
      } catch { /* next */ }
    }
  }
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const v of o) walk(v); return; }
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'usage' || k === 'token_usage' || k === 'tokens') && v && typeof v === 'object') usage = v;
      else if (k === 'content' && Array.isArray(v)) {
        for (const c of v) if (c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim()) text = text || c.text;
      } else if ((k === 'text' || k === 'response' || k === 'output_text' || k === 'last_message') && typeof v === 'string' && v.trim()) {
        if (!text) text = v;
      } else walk(v);
    }
  };
  for (const line of String(stdout ?? '').split('\n')) {
    try { walk(JSON.parse(line)); } catch { /* not json */ }
  }
  const { toolEvents, unknownTypes, toolKinds } = countCodexToolEvents(stdout);
  return { text, usage, toolEvents, unknownTypes, toolKinds, errorEnvelope: codexErrorEnvelope(stdout), rateLimits: extractCodexRateLimits(stdout) };
}

/**
 * Tool accounting of a vibe transcript (review GEPA V1): every `role: 'tool'` message and every
 * assistant message carrying tool calls (`tool_calls`, or a tool_call/tool_use/function_call
 * content part) counts. parseSeatResult then makes the call a failure, as for codex.
 */
export function countVibeToolEvents(msgs) {
  if (!Array.isArray(msgs)) return 0;
  let n = 0;
  for (const m of msgs) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'tool' || /tool|function_call/i.test(String(m.type ?? ''))) { n++; continue; }
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) { n += m.tool_calls.length; continue; }
    if (Array.isArray(m.content) && m.content.some((c) => /tool_call|tool_use|function_call/i.test(String(c?.type ?? '')))) n++;
  }
  return n;
}

export function parseVibe(stdout, dir) {
  const msgs = lastJson(stdout);
  const text = Array.isArray(msgs) ? msgs.filter((m) => m.role === 'assistant' && m.type === 'message').flatMap((m) => (m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text)).join('\n') : '';
  let exp = null;
  try { exp = JSON.parse(fs.readFileSync(path.join(dir, 'export', 'export.json'), 'utf8')); } catch { /* none */ }
  const models = Array.isArray(exp?.config?.models) ? exp.config.models : Object.values(exp?.config?.models ?? {});
  const model = models.find((m) => m?.alias === exp?.config?.active_model);
  return { text, usage: exp?.usage ?? null, costUsd: exp?.cost_usd ?? null, effectiveModel: exp?.config?.active_model ?? null,
    effectiveThinking: model?.thinking ?? null, outcome: exp?.outcome ?? null, toolEvents: countVibeToolEvents(msgs),
    errorEnvelope: [exp?.outcome && !/^(?:success|completed|ok)$/i.test(String(exp.outcome)) ? exp.outcome : '', exp?.error ?? ''].filter(Boolean).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n') };
}

// agy stream-json output: one JSON event per line; the final "result" event carries the answer
// and usage. Tool-call events are counted (an answer that used a tool is flagged by the caller).
function parseAgyStream(stdout) {
  let result = null;
  let toolEvents = 0;
  for (const line of stdout.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.event === 'result') result = e.result;
    else if (/tool/i.test(String(e.event ?? '')) || e.tool_call || e.toolCall) toolEvents++;
  }
  return { text: result?.response ?? '', usage: result?.usage ?? null, status: result?.status ?? null, error: result?.error ?? null, toolEvents,
    errorEnvelope: result?.error ? (typeof result.error === 'string' ? result.error : JSON.stringify(result.error)) : '' };
}

// muse exec --json emits JSONL events; the final answer is the "text" of the completed
// run_terminal payload (nested), usage objects may appear at any depth.
function parseMuse(stdout) {
  let text = '';
  let usage = null;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.terminal === 'completed' && typeof o.text === 'string') text = o.text;
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'usage' || k === 'token_usage') && v && typeof v === 'object') usage = v;
      else walk(v);
    }
  };
  for (const line of stdout.split('\n')) {
    try { walk(JSON.parse(line)); } catch { /* not json */ }
  }
  return { text: text || stdout.slice(-4000), usage };
}

/**
 * Kill a seat child AND its descendants. The child is spawned detached (its own
 * process group), so signalling the negative pid reaches the whole tree — a CLI
 * that forked a grandchild holding stdout open cannot survive the parent. Falls
 * back to a direct kill when group signalling is unavailable (e.g. Windows).
 */
export function killSeatTree(child, sig = 'SIGTERM') {
  try {
    if (child.pid) { process.kill(-child.pid, sig); return 'group'; }
  } catch { /* fallthrough to a direct kill */ }
  try { child.kill(sig); return 'direct'; } catch { return 'none'; }
}

/** One isolated call. Returns { code, latencyMs, timedOut, text, usage, ... }. */
export function callSeat(label, prompt, { timeoutMs = 900000, base = process.env.CLASSIF_SEAT_TMP ?? os.tmpdir(), killEscalationMs = 15000, closeGraceMs = 30000, spawnImpl = spawn } = {}) {
  const r = ROUTES[label];
  if (!r) throw new Error(`unknown route ${label}`);
  // Codex seats can run commands: their cwd is an empty per-call dir OUTSIDE $CLASSIF_HOME,
  // whatever base the caller passed (review GEPA B1b).
  const codex = r.parse === parseCodex;
  const seatBase = codex ? codexSeatBase() : base;
  fs.mkdirSync(seatBase, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(seatBase, codex ? 'classif-codex-seat-' : 'seat-'));
  const work = path.join(dir, 'work');
  const file = path.join(dir, 'prompt.md');
  // Review GEPA R3: the seat dir (it holds the prompt) is removed whatever fails before the
  // child runs — writing the prompt, building the command (a codex home refusal) or spawning.
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  let built;
  try {
    fs.mkdirSync(work);
    fs.writeFileSync(file, prompt, { mode: 0o600 });
    built = r.build(work, file, prompt);
  } catch (e) { cleanup(); throw e; }
  const { cmd, args, env, stdin } = built;
  const sessionsBefore = codex ? new Set(codexSessionFiles(env?.CODEX_HOME)) : null;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    // detached: the child leads its own process group so the timeout kill reaches descendants.
    let child;
    try {
      child = spawnImpl(cmd, args, { cwd: work, env: seatEnv(env), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    } catch (e) { cleanup(); reject(e); return; }
    let out = '';
    let err = '';
    let settled = false;
    // The seat binary is absent from PATH (spawn ENOENT, exit -2): reported as `binaryMissing`.
    let binaryMissing = false;
    const finish = (code, timedOut) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalate);
      clearTimeout(force);
      const latencyMs = Date.now() - started;
      let parsed = { text: '', usage: null };
      try { parsed = r.parse(out, work); } catch { /* keep empty */ }
      cleanup();
      // Quota source: the session file of this call (stdout stays the secondary source); the
      // file is deleted whatever happens.
      if (codex) {
        try {
          const fromSession = takeCodexSession({ codexHome: env?.CODEX_HOME, stdout: out, before: sessionsBefore });
          if (fromSession) parsed = { ...parsed, rateLimits: fromSession };
        } catch { /* session cleanup is best effort, rate limits stay from stdout */ }
      }
      // Review §10: the astra --json event stream stays in the raw record (the run.mjs raw
      // file saves this whole object), so tool-event audits are reproducible.
      const rawJsonl = codex ? out : undefined;
      const authError = codex && looksLikeAuthFailure(code, `${err}\n${out.slice(-4000)}`);
      const missing = binaryMissing || code === -2;
      resolve({ code: missing && (code === null || code === 0) ? -2 : code, latencyMs, timedOut, ...parsed, ...(rawJsonl !== undefined ? { rawJsonl } : {}), ...(authError ? { authError: true } : {}),
        ...(missing ? { binaryMissing: cmd } : {}),
        stderrTail: err.slice(-600), stdoutTail: parsed.text ? undefined : out.slice(-600) });
    };
    // Timeout: SIGTERM to the group, then SIGKILL to the group after killEscalationMs.
    const timer = setTimeout(() => {
      killSeatTree(child, 'SIGTERM');
      escalate = setTimeout(() => killSeatTree(child, 'SIGKILL'), killEscalationMs);
    }, timeoutMs);
    let escalate = null;
    // Bound on the `close` wait: a surviving descendant holding stdout open must not hang the pass.
    const force = setTimeout(() => { killSeatTree(child, 'SIGKILL'); finish(null, true); }, timeoutMs + closeGraceMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += String(e.message); if (e?.code === 'ENOENT') binaryMissing = true; });
    child.on('close', (code) => finish(code, false));
    // An early seat exit while the prompt is still piped raises EPIPE on stdin: a failure
    // of this call only (recorded in err), never an unhandled exception killing the runner.
    if (child.stdin && typeof child.stdin.on === 'function') child.stdin.on('error', (e) => { err += String(e?.message ?? e); });
    try { child.stdin.end(stdin ?? ''); } catch (e) { err += String(e?.message ?? e); }
  });
}

/** First JSON object of a model answer (fences stripped, then first "{" .. last "}"). */
export function parseJsonObject(text) {
  const t = String(text ?? '').replace(/```(?:json)?/g, '').trim();
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fallthrough */ } }
  return null;
}
