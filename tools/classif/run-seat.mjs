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
import { classifHome } from './lib/paths.mjs';

const SCRUB = /(_API_KEY|_AUTH_TOKEN|_API_BASE|_BASE_URL|_SECRET_KEY|_ACCESS_KEY)$|^(ANTHROPIC_|OPENAI_|GEMINI_|CLAUDE_CODE_USE_|AWS_|GOOGLE_CLOUD_|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_GENAI_USE_VERTEXAI|VERTEX|SCRAPE_S3_|REFERENCE_C_KEY|CLASSIF_EVAL_KEY|MISTRAL_|VIBE_ACTIVE_MODEL)/;
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
  'muse-spark-1.3-medium': {
    family: 'Muse 1.3', model: 'muse-spark-1.3', effort: 'medium', route: 'muse exec --prompt-file, preset empty, no web tools, no session log',
    build: (dir, file) => ({ cmd: 'muse', args: ['exec', '--model', 'muse-spark-1.3', '--reasoning-effort', 'medium', '--preset', 'empty', '--prompt-file', file, '--json',
      '--disable-web-tools', '--disable-reminders', '--disable-request-user-input', '--no-foreign-personal-context', '--no-session-log', '--workspace', dir] }),
    parse: parseMuse,
  },
  // agy: prompt on stdin as one stream-json "user" event (no 128 KB argument limit, L0 open point).
  ...Object.fromEntries(['high', 'medium', 'low'].map((e) => [`gemini-4-argon-${e}`, {
    family: 'Gemini 4 Argon', model: `gemini-4-argon-${e}`, effort: e, route: 'agy --print= with stream-json stdin input, slash commands disabled, empty cwd',
    build: (_dir, _file, prompt) => ({ cmd: 'agy', args: ['--model', `gemini-4-argon-${e}`, '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--disable-slash-commands', '--print='], stdin: `${JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } })}\n` }),
    parse: parseAgyStream,
  }])),
  ...Object.fromEntries(['max', 'medium'].map((e) => [`opus-5.5-${e}`, {
    family: 'Opus 5.5', model: 'claude-opus-5-5', effort: e, route: 'isolated claude -p: no tools, no CLAUDE.md (CLAUDE_CODE_DISABLE_CLAUDE_MDS=1), project settings only, neutral system prompt, empty MCP config, no session persistence, empty cwd',
    build: (_dir, _file, prompt) => ({ cmd: 'claude', args: ['-p', '--model', 'claude-opus-5-5', '--effort', e, '--output-format', 'json',
      '--tools', '', '--setting-sources', 'project', '--no-session-persistence', '--system-prompt', NEUTRAL_SYSTEM,
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], stdin: prompt, env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1' } }),
    parse: (stdout) => { const j = lastJson(stdout); return { text: j?.result ?? '', usage: j?.usage ?? null, costUsdApiEquivalent: j?.total_cost_usd ?? null, isError: j?.is_error ?? false }; },
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

/** One isolated call. Returns { code, latencyMs, text, usage, ... }. */
export function callSeat(label, prompt, { timeoutMs = 900000, base = process.env.CLASSIF_SEAT_TMP ?? os.tmpdir() } = {}) {
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
    const child = spawn(cmd, args, { cwd: work, env: seatEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += String(e.message); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      let parsed = { text: '', usage: null };
      try { parsed = r.parse(out, work); } catch { /* keep empty */ }
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, latencyMs, ...parsed, stderrTail: err.slice(-600), stdoutTail: parsed.text ? undefined : out.slice(-600) });
    });
    child.stdin.end(stdin ?? '');
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
