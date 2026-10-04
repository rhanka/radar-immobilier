// Seat-only model routes (no API key ever): every child process gets an environment from which
// all *_API_KEY / provider base-URL variables are removed, and runs in an empty working
// directory with tools disabled or a read-only sandbox, so the model sees only the prompt.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRUB = /(_API_KEY|^ANTHROPIC_BASE_URL|^OPENAI_BASE_URL|^GOOGLE_APPLICATION_CREDENTIALS|^GOOGLE_GENAI_USE_VERTEXAI)$/;
export function seatEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!SCRUB.test(k)) env[k] = v;
  return env;
}

export const MODELS = {
  astra: {
    label: 'Astra low', model: 'gpt-6-astra', effort: 'low', route: 'codex exec (ChatGPT seat), read-only sandbox, empty cwd',
    command: (dir) => ['codex', ['exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort=low', '-s', 'read-only',
      '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--json', '-C', dir,
      '--output-last-message', path.join(dir, 'last.txt'), '-']],
    stdin: (system, user) => `${system}\n\n---\n\n${user}`,
    parse: (stdout, dir) => {
      const text = fs.existsSync(path.join(dir, 'last.txt')) ? fs.readFileSync(path.join(dir, 'last.txt'), 'utf8') : '';
      let usage = null;
      for (const line of stdout.split('\n')) {
        try { const e = JSON.parse(line); const u = e.usage ?? e.msg?.usage ?? e.info?.total_token_usage; if (u) usage = u; } catch { /* not json */ }
      }
      return { text, usage };
    },
  },
  gemini: {
    label: 'Gemini low', model: 'gemini-3.8-flash-low', effort: 'low', route: 'agy --print (Antigravity seat), empty cwd',
    command: (dir) => ['agy', ['--model', 'gemini-3.8-flash-low', '--output-format', 'json', '--disable-slash-commands']],
    argPrefix: '--print=',
    stdinAsArg: true,
    stdin: (system, user) => `${system}\n\n---\n\n${user}`,
    parse: (stdout) => {
      try { const j = JSON.parse(stdout); return { text: j.result ?? j.response ?? j.text ?? stdout, usage: j.usage ?? j.stats ?? null }; } catch { return { text: stdout, usage: null }; }
    },
  },
  opus: {
    label: 'Claude Opus 5.5 low', model: 'claude-opus-5-5', effort: 'low', route: 'claude -p (Claude seat), --effort low, tools disabled, empty cwd',
    command: (dir, system) => ['claude', ['-p', '--model', 'claude-opus-5-5', '--effort', 'low', '--output-format', 'json',
      '--system-prompt', system, '--disallowed-tools', '*', '--strict-mcp-config']],
    stdin: (_system, user) => user,
    parse: (stdout) => {
      try {
        const j = JSON.parse(stdout);
        return { text: j.result ?? '', usage: j.usage ?? null, costUsdApiEquivalent: j.total_cost_usd ?? null, isError: j.is_error ?? false };
      } catch { return { text: stdout, usage: null }; }
    },
  },
};

export function callModel(key, system, user, { timeoutMs = 300000 } = {}) {
  const m = MODELS[key];
  const base = process.env.ORACLE_C_TMP ?? os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, `oc-${key}-`));
  const [cmd, args0] = m.command(dir, system);
  const input = m.stdin(system, user);
  const args = m.stdinAsArg ? [...args0, `${m.argPrefix ?? ''}${input}`] : args0;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: dir, env: seatEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      let parsed = { text: '', usage: null };
      try { parsed = m.parse(out, dir); } catch { /* keep empty */ }
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, latencyMs, ...parsed, stderrTail: err.slice(-800), stdoutTail: parsed.text ? undefined : out.slice(-800) });
    });
    if (!m.stdinAsArg) child.stdin.end(input); else child.stdin.end();
  });
}

/** Extract the first JSON object from a model answer (fences stripped, then first "{" .. last "}"). */
export function parseJsonObject(text) {
  const t = String(text ?? '').replace(/```(?:json)?/g, '').trim();
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fallthrough */ } }
  return null;
}
