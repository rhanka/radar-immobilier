#!/usr/bin/env node
// make classif-quota-status ENV=preprod — last known ChatGPT quota measurement per codex seat
// (astra-max, sol-6.1-low, luna-6-low) from $CLASSIF_HOME/l2/calls.jsonl: used percentage of the
// weekly quota, reset time (UTC) and age of the measurement. No model call, no write.
import path from 'node:path';
import process from 'node:process';
import { ROUTES, isCodexSeat } from './run-seat.mjs';
import { classifHome } from './lib/paths.mjs';
import { CODEX_QUOTA_PAUSE_DEFAULT, parseQuotaPause, quotaStatus } from './lib/codex-quota.mjs';

export function formatQuotaStatus(status, threshold = CODEX_QUOTA_PAUSE_DEFAULT) {
  const lines = [`codex seat quota (pause at ${threshold} %):`];
  for (const [seat, s] of Object.entries(status)) {
    if (!s) { lines.push(`- ${seat}: unknown (no measurement in calls.jsonl)`); continue; }
    const age = s.ageMinutes < 120 ? `${s.ageMinutes} min` : `${Math.round(s.ageMinutes / 60)} h`;
    const flag = s.reachedType ? ` — rate limit reached (${s.reachedType})` : (typeof s.usedPercent === 'number' && s.usedPercent >= threshold ? ' — PAUSED' : '');
    lines.push(`- ${seat}: ${s.usedPercent ?? '?'} % used, resets at ${s.resetsAt ?? 'unknown'} (UTC), measured ${age} ago (${s.at})${flag}`);
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('quota-status.mjs')) {
  const seats = Object.keys(ROUTES).filter(isCodexSeat);
  const threshold = parseQuotaPause(process.env.CODEX_QUOTA_PAUSE);
  process.stdout.write(`${formatQuotaStatus(quotaStatus(path.join(classifHome(), 'l2', 'calls.jsonl'), { seats }), threshold)}\n`);
}
