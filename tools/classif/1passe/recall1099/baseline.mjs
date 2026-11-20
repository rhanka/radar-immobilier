import fs from 'node:fs';
import assert from 'node:assert/strict';
import { sha256 } from '../../lib/refc1.mjs';
import { json } from './context.mjs';
import { graphActs } from './metrics.mjs';
export const bench = '/home/antoinefa/src/radar-immobilier/.claude/worktrees/agent-ae1c01a14a9859391/tools/bench-v11';
export const arm = `${bench}/full/arms/astra-medium-rejeu`;
export function baseline(d) {
  const p = `${arm}/validated/medium--${d.id}.output.json`;
  if (!fs.existsSync(p)) return { missing: true, acts: [] };
  const receipt = json(`${arm}/validated/medium--${d.id}.receipt.json`);
  assert(receipt.validation.accepted, 'B receipt not accepted');
  return { acts: graphActs(json(p), d), usage: json(`${arm}/usage/medium--${d.id}.json`).usage,
    sha256: sha256(fs.readFileSync(p)) };
}
