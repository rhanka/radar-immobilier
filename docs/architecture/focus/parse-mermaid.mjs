// A deliberately bounded adapter for this repository's quoted flowchart syntax.
// Unsupported statements fail the build; no relationship may silently disappear.
export function parseMermaid(source, id, title) {
  const nodes = new Map(), groups = new Map(), edges = [], stack = [];
  const definition = /\b([A-Za-z_][\w-]*)\s*(?:\[\("([^"]+)"\)\]|\["([^"]+)"\])/g;
  const label = value => value.replace(/<br\s*\/?\s*>/gi, '\n');
  for (const [offset, original] of source.split('\n').entries()) {
    const line = original.trim(), lineNumber = offset + 1;
    if (!line || /^(flowchart|classDef|class |%%)/.test(line)) continue;
    if (line === 'end') { if (!stack.pop()) throw Error(`${id}: unexpected end`); continue; }
    const group = line.match(/^subgraph\s+([\w-]+)\["([^"]+)"\]$/);
    if (group) {
      groups.set(group[1], { id: group[1], label: label(group[2]), parent: stack.at(-1) ?? null, line: lineNumber });
      stack.push(group[1]); continue;
    }
    let definitions = 0;
    const stripped = line.replace(definition, (_, nodeId, rounded, square) => {
      definitions++;
      const value = { id: nodeId, label: label(rounded ?? square), parent: stack.at(-1) ?? null,
        store: rounded !== undefined, line: lineNumber };
      if (nodes.has(nodeId)) throw Error(`${id}: duplicate ${nodeId}`);
      nodes.set(nodeId, value); return nodeId;
    });
    const edge = stripped.match(/^([\w-]+)\s*(<-->|-->|-\.->)\s*(?:\|"([^"]*)"\|\s*)?([\w-]+)$/);
    if (edge) edges.push({ id: `${id}-e${edges.length}`, source: edge[1], target: edge[4],
      label: label(edge[3] ?? ''), dashed: edge[2] === '-.->', both: edge[2] === '<-->', line: lineNumber });
    else if (!(definitions === 1 && /^[\w-]+$/.test(stripped))) throw Error(`${id}:${lineNumber} unsupported: ${line}`);
  }
  if (stack.length) throw Error(`${id}: unclosed groups`);
  for (const edge of edges) for (const end of [edge.source, edge.target]) {
    if (!nodes.has(end)) throw Error(`${id}: undeclared endpoint ${end}`);
  }
  for (const node of nodes.values()) node.resource = node.label.match(/^\[([^\]]+)\]/)?.[1] ?? null;
  return { id, title, source, nodes: [...nodes.values()], groups: [...groups.values()], edges };
}

export function extractDiagrams(markdown, titles, prefix) {
  const blocks = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)];
  if (blocks.length !== titles.length) throw Error(`${prefix}: Mermaid diagram count changed`);
  return blocks.map((match, index) => parseMermaid(match[1], `${prefix}-${index + 1}`, titles[index]));
}
