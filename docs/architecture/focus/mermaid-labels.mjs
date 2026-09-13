// Runs against both build-time SVG and the final, sanitized browser DOM.
export function missingMermaidLabels(svg, graph) {
  const compact = text => text
    .replace(/&(?:amp;)?gt;/g, '>')
    .replace(/&(?:amp;)?lt;/g, '<')
    .replace(/&(?:amp;)?amp;/g, '&')
    .replace(/\s+/g, '');
  const missing = [];
  for (const [items, selector] of [[graph.nodes, 'g.node'], [graph.groups, 'g.cluster']]) {
    const elements = [...svg.querySelectorAll(selector)];
    for (const item of items) {
      const element = elements.find(e => e.id === item.id || e.id.startsWith(`flowchart-${item.id}-`));
      const actual = element?.textContent ?? '';
      if (compact(actual) !== compact(item.label)) missing.push({ id: item.id, expected: item.label, actual });
    }
  }
  const captions = [...svg.querySelectorAll('g.edgeLabels > g')].map(e => compact(e.textContent));
  for (const edge of graph.edges.filter(e => e.label)) {
    const index = captions.indexOf(compact(edge.label));
    if (index < 0) missing.push({ id: edge.id, expected: edge.label, actual: '(edge caption missing)' });
    else captions.splice(index, 1);
  }
  return missing;
}
