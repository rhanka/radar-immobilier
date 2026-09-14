import { createHash } from 'node:crypto';

export const normalizeLabel = value => value.replace(/\r\n?/g, '\n')
  .replace(/<br\s*\/?\s*>/gi, '\n').split('\n')
  .map(line => line.trim().replace(/[\t ]+/g, ' ')).join('\n').normalize('NFC');

export const edgeId = (source, target, label) =>
  `${source}__${target}__${createHash('sha256').update(normalizeLabel(label)).digest('hex').slice(0, 12)}`;

// Bounded parser for the canonical quoted Mermaid subset. Unknown syntax fails.
export function parseMermaid(source, id, title, pair, date) {
  const nodes = new Map(), groups = new Map(), edges = [], stack = [], edgeKeys = new Set();
  const definition = /\b([A-Za-z_][\w-]*)\s*(?:\[\("([^"]+)"\)\]|\["([^"]+)"\])/g;
  for (const [offset, original] of source.replace(/\r\n?/g, '\n').split('\n').entries()) {
    const line = original.trim(), lineNumber = offset + 1;
    if (!line || /^(flowchart|%%)/.test(line)) continue;
    if (/[&](?:[a-z]+|#[0-9]+);/i.test(line)) throw Error(`${id}:${lineNumber} HTML entity forbidden`);
    if (line === 'end') { if (!stack.pop()) throw Error(`${id}: unexpected end`); continue; }
    const group = line.match(/^subgraph\s+([\w-]+)\["([^"]+)"\]$/);
    if (group) {
      if (nodes.has(group[1]) || groups.has(group[1])) throw Error(`${id}: duplicate ${group[1]}`);
      groups.set(group[1], { id: group[1], label: normalizeLabel(group[2]), parent: stack.at(-1) ?? null, line: lineNumber });
      stack.push(group[1]); continue;
    }
    let definitions = 0;
    const stripped = line.replace(definition, (_, nodeId, rounded, square) => {
      definitions++;
      if (nodes.has(nodeId) || groups.has(nodeId)) throw Error(`${id}: duplicate ${nodeId}`);
      nodes.set(nodeId, { id: nodeId, label: normalizeLabel(rounded ?? square), parent: stack.at(-1) ?? null,
        store: rounded !== undefined, line: lineNumber });
      return nodeId;
    });
    const edge = stripped.match(/^([\w-]+)\s*(<-->|-->|-\.->)\s*(?:\|"([^"]*)"\|\s*)?([\w-]+)$/);
    if (edge) {
      const label = normalizeLabel(edge[3] ?? ''), key = `${edge[1]}\0${edge[4]}\0${label}`;
      if (edgeKeys.has(key)) throw Error(`${id}:${lineNumber} duplicate endpoint+label edge`);
      edgeKeys.add(key);
      edges.push({ id: edgeId(edge[1], edge[4], label), source: edge[1], target: edge[4], label,
        dashed: edge[2] === '-.->', both: edge[2] === '<-->', line: lineNumber });
    } else if (!(definitions === 1 && /^[\w-]+$/.test(stripped))) throw Error(`${id}:${lineNumber} unsupported: ${line}`);
  }
  if (stack.length) throw Error(`${id}: unclosed groups`);
  for (const edge of edges) for (const endpoint of [edge.source, edge.target]) {
    if (!nodes.has(endpoint)) throw Error(`${id}: undeclared endpoint ${endpoint}`);
  }
  return { id, title, pair, date, source, nodes: [...nodes.values()], groups: [...groups.values()], edges };
}

export function extractCanonicalDiagrams(markdown) {
  const head = markdown.split('## Annexe historique D8')[0];
  const matches = [...head.matchAll(/### `([^`]+)` — ([^\n]+)\n\n```mermaid\n([\s\S]*?)```/g)];
  const expected = [
    ['storage-before-20260809', 'Paire A · production AVANT', 'A', '2026-08-09'],
    ['storage-after-20260913', 'Paire A · production APRÈS', 'A', '2026-09-13'],
    ['refresh-before-20260809', 'Paire B · refresh AVANT', 'B', '2026-08-09'],
    ['refresh-after-20260913', 'Paire B · refresh APRÈS', 'B', '2026-09-13'],
  ];
  if (matches.length !== expected.length) throw Error(`canonical Mermaid count ${matches.length}, expected 4`);
  return matches.map((match, index) => {
    const [sceneId, title, pair, date] = expected[index];
    if (match[1] !== sceneId) throw Error(`scene order mismatch: ${match[1]} != ${sceneId}`);
    return parseMermaid(match[3], sceneId, title, pair, date);
  });
}
