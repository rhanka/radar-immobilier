// Shared ChatGPT quota guard (codex seats sol-6.1-low, astra-max, luna-6-low): those seats share
// the weekly ChatGPT quota with the production immo daily detection. codex writes the quota
// (`token_count` event, `rate_limits`) to the session file of each call, not to the --json stdout
// (verified on a real call): callSeat reads it then deletes it; stdout stays a secondary source.
// The pilot pauses its codex
// seats once a call reports `used_percent >= CODEX_QUOTA_PAUSE` (default 85) or a non-null
// `rate_limit_reached_type`. No model call here: parsing, logging fields, guard state, status.
import { existsSync, readFileSync } from 'node:fs';

export const CODEX_QUOTA_PAUSE_DEFAULT = 85;

/** CODEX_QUOTA_PAUSE value (Make variable / --codex-quota-pause): a percentage in ]0,100]. */
export function parseQuotaPause(value) {
  if (value === undefined || value === null || value === '') return CODEX_QUOTA_PAUSE_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100) throw new Error(`CODEX_QUOTA_PAUSE must be a percentage in ]0,100] (got ${value})`);
  return n;
}

/**
 * Last `rate_limits` object of a codex --json stdout, normalised to
 * { primary: { used_percent, window_minutes, resets_at }, plan_type, rate_limit_reached_type },
 * wherever it sits (a `token_count` event, an `event_msg` payload, a turn event). null if none.
 */
export function extractCodexRateLimits(stdout) {
  let last = null;
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (o.rate_limits && typeof o.rate_limits === 'object') last = o.rate_limits;
    for (const [k, v] of Object.entries(o)) if (k !== 'rate_limits' && v && typeof v === 'object') walk(v, depth + 1);
  };
  for (const line of String(stdout ?? '').split('\n')) {
    if (!line.includes('rate_limits')) continue;
    try { walk(JSON.parse(line), 0); } catch { /* not json */ }
  }
  if (!last) return null;
  const p = last.primary ?? null;
  return {
    primary: p ? { used_percent: typeof p.used_percent === 'number' ? p.used_percent : null, window_minutes: p.window_minutes ?? null, resets_at: p.resets_at ?? null } : null,
    plan_type: last.plan_type ?? null,
    rate_limit_reached_type: last.rate_limit_reached_type ?? null,
  };
}

/** UTC ISO time of a `resets_at` (epoch seconds), or null. */
export const resetsAtIso = (resetsAt) => (typeof resetsAt === 'number' && Number.isFinite(resetsAt) ? new Date(resetsAt * 1000).toISOString() : null);

/** calls.jsonl fields of one seat result: quotaUsedPercent, quotaResetsAt (UTC ISO), quotaReachedType. */
export function quotaFields(r) {
  const rl = r?.rateLimits;
  if (!rl) return {};
  return { quotaUsedPercent: rl.primary?.used_percent ?? null, quotaResetsAt: resetsAtIso(rl.primary?.resets_at),
    ...(rl.rate_limit_reached_type ? { quotaReachedType: rl.rate_limit_reached_type } : {}) };
}

/** Typed stop of a run paused by the quota guard. */
export class CodexQuotaPause extends Error {
  constructor(message, info) {
    super(message);
    this.name = 'CodexQuotaPause';
    this.info = info;
  }
}

/**
 * Guard state of one run. `observe(seat, rateLimits)` records a codex measurement and pauses the
 * guard at `used_percent >= threshold` or on a non-null `rate_limit_reached_type`; once paused,
 * callers launch no further codex call (`blocks(seat)`) and stop with `error(resumeCommand)`.
 */
export function createQuotaGuard({ threshold = CODEX_QUOTA_PAUSE_DEFAULT, isCodex }) {
  let paused = null;
  return {
    threshold,
    get paused() { return paused; },
    blocks: (seat) => Boolean(paused) && isCodex(seat),
    observe(seat, rateLimits) {
      if (paused || !rateLimits || !isCodex(seat)) return paused;
      const used = rateLimits.primary?.used_percent;
      const reached = rateLimits.rate_limit_reached_type ?? null;
      if (reached || (typeof used === 'number' && used >= threshold)) {
        paused = { seat, usedPercent: typeof used === 'number' ? used : null, resetsAt: resetsAtIso(rateLimits.primary?.resets_at), reached };
      }
      return paused;
    },
    error(resumeCommand) {
      const p = paused;
      const why = p.reached ? `rate_limit_reached_type=${p.reached}` : `${p.usedPercent}% of the weekly ChatGPT quota used (>= ${threshold}%)`;
      return new CodexQuotaPause(`codex quota guard: ${p.seat} reports ${why}${p.reached && p.usedPercent !== null ? ` at ${p.usedPercent}%` : ''}; quota resets at ${p.resetsAt ?? 'unknown'} (UTC). No further codex call launched, run stopped (answered calls are cached). Resume after the reset with \`${resumeCommand}\` (CODEX_QUOTA_PAUSE=<pct> changes the threshold).`, { ...p, threshold });
    },
  };
}

/**
 * Last quota measurement per codex seat from calls.jsonl result records (no call): { seat:
 * { usedPercent, resetsAt, reachedType, at, ageMinutes } }.
 */
export function quotaStatus(callsLog, { seats, now = Date.now() } = {}) {
  const out = Object.fromEntries((seats ?? []).map((s) => [s, null]));
  if (!existsSync(callsLog)) return out;
  for (const line of readFileSync(callsLog, 'utf8').split('\n')) {
    if (!line.includes('quotaUsedPercent')) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    const seat = r.route ?? r.annotator;
    if (!seat || (seats && !seats.includes(seat))) continue;
    const prev = out[seat];
    if (!prev || String(r.at) >= prev.at) {
      out[seat] = { usedPercent: r.quotaUsedPercent ?? null, resetsAt: r.quotaResetsAt ?? null, reachedType: r.quotaReachedType ?? null, at: r.at,
        ageMinutes: Math.round((now - Date.parse(r.at)) / 60000) };
    }
  }
  return out;
}
