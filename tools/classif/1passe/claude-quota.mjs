// Lecture de quota seule. Le jeton reste en mémoire et n’est jamais journalisé.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { home, writePrivate } from './context.mjs';
const result = { at: new Date().toISOString(), available: false };
try {
  const credentials = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
  const token = credentials.claudeAiOauth?.accessToken;
  if (typeof token === 'string' && token.length) {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15000),
    });
    result.httpStatus = response.status;
    if (response.ok) {
      const body = await response.json();
      result.available = true;
      for (const key of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']) {
        const q = body[key];
        if (q && typeof q.utilization === 'number') result[key] = { usedPercent: q.utilization, resetsAt: q.resets_at };
      }
    }
  } else result.cause = 'télémétrie de siège indisponible';
} catch { result.cause = 'lecture de quota indisponible'; }
writePrivate(`${home}/annotation/claude-quota-after.json`, result);
console.log(JSON.stringify(result));
