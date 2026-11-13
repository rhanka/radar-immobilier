import fs from 'node:fs';
import assert from 'node:assert/strict';
import { sha256 } from '../../lib/refc1.mjs';
import { json } from './context.mjs';
export const bench = '/home/antoinefa/src/radar-immobilier/.claude/worktrees/agent-ae1c01a14a9859391/tools/bench-v11';
export const arm = `${bench}/full/arms/astra-medium-rejeu`;
export function baseline(d) {
  assert.equal(sha256(fs.readFileSync(`${bench}/full/corpus/text/${d.id}.txt`)), d.textSha256, 'B and candidate must use identical text');
  const p = `${arm}/validated/medium--${d.id}.output.json`;
  if (!fs.existsSync(p)) return { missing: true, acts: [] };
  const receipt = json(`${arm}/validated/medium--${d.id}.receipt.json`);
  assert(receipt.validation.accepted, 'B receipt not accepted');
  const output = json(p), evidence = new Map((output.evidence ?? []).map((e) => [e.id, e]));
  const eligible = output.nodes.filter((n) => ['Signal', 'DesignationEvent', 'Bylaw'].includes(n.node_type));
  const parents = new Map(eligible.map((n) => [n.id, n.id]));
  const root = (id) => parents.get(id) === id ? id : root(parents.get(id));
  for (const e of output.edges ?? []) if (e.relation === 'raises_signal' && parents.has(e.source) && parents.has(e.target)) parents.set(root(e.target), root(e.source));
  const groups = new Map();
  for (const n of eligible) groups.set(root(n.id), [...(groups.get(root(n.id)) ?? []), n]);
  const acts = [...groups].map(([id, nodes]) => ({ id, variants: nodes.flatMap((n) => {
    const props = n.properties ?? n;
    return [...(n.citations ?? []), ...(n.evidence_refs ?? []).map((id) => evidence.get(id)).filter(Boolean)]
      .filter((c) => c.docSha === d.sha256 && c.source_file === d.originalKey && c.rawRef === d.originalKey
        && c.sourceUrl === d.sourceUrl && c.modality === 'pdf')
      .map((c) => ({ id, target_number: props.no_reglement ?? null, object: `${n.label ?? ''} ${props.description ?? ''}`,
        stage: props.etape ?? props.stage ?? props.stade ?? '', page: c.page, quote: c.excerpt }));
  }) }));
  const usage = json(`${arm}/usage/medium--${d.id}.json`).usage;
  return { acts, usage, sha256: sha256(fs.readFileSync(p)) };
}
