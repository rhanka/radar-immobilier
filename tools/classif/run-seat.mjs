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

const SCRUB = /(_API_KEY|_AUTH_TOKEN|_API_BASE|_BASE_URL|_SECRET_KEY|_ACCESS_KEY)$|^(ANTHROPIC_|OPENAI_|GEMINI_|CLAUDE_CODE_USE_|AWS_|GOOGLE_CLOUD_|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_GENAI_USE_VERTEXAI|VERTEX|SCRAPE_S3_|REFERENCE_C_KEY|CLASSIF_EVAL_KEY|CLASSIF_BLIND_KEY|MISTRAL_|VIBE_ACTIVE_MODEL)/;
export function seatEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!SCRUB.test(k)) env[k] = v;
  return { ...env, ...extra };
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
    parse: (stdout) => { const j = lastJson(stdout); return { text: j?.result ?? '', usage: j?.usage ?? null, costUsdApiEquivalent: j?.total_cost_usd ?? null, isError: j?.is_error ?? false }; },
  }])),
  // Astra (ChatGPT seat, plan v3 owner decision 04/11): conductor-verified route
  // `codex exec -m gpt-6-astra -c model_reasoning_effort=max -s read-only`, empty cwd, scrubbed
  // env, isolated CODEX_HOME ($CLASSIF_HOME/seat-homes/astra, mode 700, config with NO
  // mcp_servers, auth copied from ~/.codex/auth.json). Machine flags added for parsing only:
  // `--json` (JSONL events on stdout) and `-o last-message.md` (the model's final message on
  // disk); the prompt goes through stdin (`-`, no 128 KB argument limit).
  // `--skip-git-repo-check` allows the empty non-repo cwd; `--ephemeral` keeps session files
  // out of the seat. codex reads CODEX_HOME (verified: unknown CODEX_HOME warns, isolated
  // home with copied auth.json connects, `codex doctor` auth mode chatgpt).
  'astra-max': {
    family: 'Astra', model: 'gpt-6-astra', effort: 'max', route: 'codex exec -m gpt-6-astra -c model_reasoning_effort=max -s read-only, isolated CODEX_HOME, empty cwd, scrubbed env (--json + -o last-message.md for parsing, prompt on stdin)',
    build: (dir, _file, prompt) => ({ cmd: 'codex', args: ['exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort=max', '-s', 'read-only',
      '--skip-git-repo-check', '--ephemeral', '--json', '-o', path.join(dir, 'last-message.md'), '-'], stdin: prompt,
      env: { CODEX_HOME: ensureAstraHome() } }),
    parse: parseCodex,
  },
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

// Isolated CODEX_HOME for the astra seat (review §10): $CLASSIF_HOME/seat-homes/astra/
// (mode 700). Holds a config with NO mcp_servers and only the auth file copied from
// ~/.codex/auth.json (mode 600). codex reads CODEX_HOME (verified 2026-11-05: unknown
// CODEX_HOME warns, isolated home with copied auth connects, doctor reports auth mode
// chatgpt). The seat env sets CODEX_HOME to this dir, so the seat never sees the user's
// ~/.codex/config.toml MCP servers.
export function astraCodexHomeDir(home = classifHome()) {
  return path.join(home, 'seat-homes', 'astra');
}

export const ASTRA_ISOLATED_CONFIG = `# Classification pilot — isolated Astra seat (review §10).
# NO mcp_servers section: any MCP exposure fails the call (parseCodex counts it).
# Auth comes from auth.json copied from ~/.codex/auth.json (never committed).
model = "gpt-6-astra"
model_reasoning_effort = "max"
web_search = "disabled"
approval_policy = "never"
sandbox_mode = "read-only"
`;

export function ensureAstraHome(home = classifHome(), { authSrc = testOnlyEnv(process.env, 'CLASSIF_ASTRA_AUTH_SRC') ?? null } = {}) {
  const dir = astraCodexHomeDir(home);
  privateDir(dir);
  fs.writeFileSync(path.join(dir, 'config.toml'), ASTRA_ISOLATED_CONFIG, { mode: 0o600 });
  // Review D1/D2: hermetic tests set CLASSIF_ASTRA_AUTH_SRC to a fake auth file in
  // test mode (CLASSIF_TEST_MODE=1) — production refuses the hook, the real
  // ~/.codex/auth.json is never read in tests.
  const src = authSrc ?? path.join(os.homedir(), '.codex', 'auth.json');
  const dst = path.join(dir, 'auth.json');
  if (src && fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o600);
  } else if (!fs.existsSync(dst)) {
    throw new Error(`astra isolation refused: no auth to copy (${src} absent and ${dst} absent)`);
  }
  return dir;
}

// codex exec --json: one JSON event per line; the model's final message is also written to
// last-message.md (-o). Usage rides on turn completion events. Fail-closed tool accounting
// (review §10): every tool/command/MCP/web-search/file event counts, and any UNKNOWN event
// or item type counts too — the caller nulls the vote when toolEvents > 0.
export const CODEX_KNOWN_EVENT_TYPES = new Set([
  'thread.started', 'turn.started', 'turn.completed', 'turn.failed',
  'item.started', 'item.updated', 'item.completed',
]);

// Only these item types are benign model output. Everything else (command_execution,
// file_change, mcp_tool_call, collab_tool_call, web_search, todo_list, plan_update,
// error items, or any unknown type) is a tool event.
export const CODEX_BENIGN_ITEM_TYPES = new Set(['agent_message', 'reasoning']);

const CODEX_TOOL_KEY = /(tool_call|toolcall|function_call|exec_command|shell_command|command_execution|file_change|mcp|web_search|websearch)/i;

export function countCodexToolEvents(stdout) {
  let toolEvents = 0;
  const unknownTypes = [];
  for (const line of String(stdout ?? '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    // Review §10: fail closed on form — a non-JSON line is not a benign event.
    try { e = JSON.parse(line); } catch { toolEvents++; unknownTypes.push('<non-json>'); continue; }
    const type = e?.type ?? e?.event ?? null;
    if (!type || typeof type !== 'string') { toolEvents++; unknownTypes.push('<missing-type>'); continue; }
    if (!CODEX_KNOWN_EVENT_TYPES.has(type)) { toolEvents++; unknownTypes.push(type); continue; }
    if (type.startsWith('item.')) {
      const item = e?.item ?? e?.data ?? e;
      const itype = item?.type ?? null;
      if (!itype || typeof itype !== 'string') { toolEvents++; unknownTypes.push(`${type}:<missing-item-type>`); continue; }
      if (!CODEX_BENIGN_ITEM_TYPES.has(itype)) { toolEvents++; continue; }
      // Fail closed on a tool payload nested inside a benign item (keys only, never the
      // model text: the word "tool" in prose must not count).
      if (CODEX_TOOL_KEY.test(JSON.stringify(Object.keys(item)))) toolEvents++;
    }
  }
  return { toolEvents, unknownTypes };
}

export function parseCodex(stdout, dir) {
  let usage = null;
  let text = '';
  try {
    const last = fs.readFileSync(path.join(dir, 'last-message.md'), 'utf8').trim();
    if (last) text = last;
  } catch { /* file absent: fall back to the events */ }
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
  const { toolEvents, unknownTypes } = countCodexToolEvents(stdout);
  // Prefer agent_message text from item.completed events when the file is absent.
  if (!text) {
    for (const line of String(stdout ?? '').split('\n')) {
      try {
        const e = JSON.parse(line);
        if (e?.type === 'item.completed' && e?.item?.type === 'agent_message' && typeof e.item.text === 'string' && e.item.text.trim()) text = e.item.text;
      } catch { /* next */ }
    }
  }
  return { text, usage, toolEvents, unknownTypes };
}

function parseVibe(stdout, dir) {
  const msgs = lastJson(stdout);
  const text = Array.isArray(msgs) ? msgs.filter((m) => m.role === 'assistant' && m.type === 'message').flatMap((m) => (m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text)).join('\n') : '';
  let exp = null;
  try { exp = JSON.parse(fs.readFileSync(path.join(dir, 'export', 'export.json'), 'utf8')); } catch { /* none */ }
  const models = Array.isArray(exp?.config?.models) ? exp.config.models : Object.values(exp?.config?.models ?? {});
  const model = models.find((m) => m?.alias === exp?.config?.active_model);
  return { text, usage: exp?.usage ?? null, costUsd: exp?.cost_usd ?? null, effectiveModel: exp?.config?.active_model ?? null,
    effectiveThinking: model?.thinking ?? null, outcome: exp?.outcome ?? null };
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
  return { text: result?.response ?? '', usage: result?.usage ?? null, status: result?.status ?? null, error: result?.error ?? null, toolEvents };
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
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(base, 'seat-'));
  const work = path.join(dir, 'work');
  fs.mkdirSync(work);
  const file = path.join(dir, 'prompt.md');
  fs.writeFileSync(file, prompt, { mode: 0o600 });
  const { cmd, args, env, stdin } = r.build(work, file, prompt);
  const started = Date.now();
  return new Promise((resolve) => {
    // detached: the child leads its own process group so the timeout kill reaches descendants.
    const child = spawnImpl(cmd, args, { cwd: work, env: seatEnv(env), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (code, timedOut) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(escalate);
      clearTimeout(force);
      const latencyMs = Date.now() - started;
      let parsed = { text: '', usage: null };
      try { parsed = r.parse(out, work); } catch { /* keep empty */ }
      fs.rmSync(dir, { recursive: true, force: true });
      // Review §10: the astra --json event stream stays in the raw record (the run.mjs raw
      // file saves this whole object), so tool-event audits are reproducible.
      const rawJsonl = label === 'astra-max' ? out : undefined;
      resolve({ code, latencyMs, timedOut, ...parsed, ...(rawJsonl !== undefined ? { rawJsonl } : {}), stderrTail: err.slice(-600), stdoutTail: parsed.text ? undefined : out.slice(-600) });
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
    child.on('error', (e) => { err += String(e.message); });
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
