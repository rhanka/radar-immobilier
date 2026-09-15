// Runs against both build-time SVG and the final, sanitized browser DOM.
export function missingMermaidLabels(svg, graph) {
  const compact = text => text
    .replace(/&(?:amp;)?gt;/g, '>')
    .replace(/&(?:amp;)?lt;/g, '<')
    .replace(/&(?:amp;)?amp;/g, '&')
    .replace(/\s+/g, '');
  const missing = [];
  const nodes = [...svg.querySelectorAll('g.node')];
  const nodeCaptions = nodes.map(element => compact(element.textContent));
  for (const item of graph.nodes) {
    const candidates = nodes.filter(element => element.id === item.id || element.id.startsWith(`flowchart-${item.id}-`));
    const direct = candidates.map(element => element.textContent ?? '').find(text => compact(text) === compact(item.label));
    const index = nodeCaptions.indexOf(compact(item.label));
    if (!direct && index < 0) missing.push({ id: item.id, expected: item.label, actual: '(node caption missing)' });
    else if (index >= 0) nodeCaptions.splice(index, 1);
  }
  const clusterCaptions = [...svg.querySelectorAll('g.cluster')].map(element => compact(element.textContent));
  for (const item of graph.groups) {
    const index = clusterCaptions.indexOf(compact(item.label));
    if (index < 0) missing.push({ id: item.id, expected: item.label, actual: '(cluster caption missing)' });
    else clusterCaptions.splice(index, 1);
  }
  const captions = [...svg.querySelectorAll('g.edgeLabels > g')].map(e => compact(e.textContent));
  for (const edge of graph.edges.filter(e => e.label)) {
    const index = captions.indexOf(compact(edge.label));
    if (index < 0) missing.push({ id: edge.id, expected: edge.label, actual: '(edge caption missing)' });
    else captions.splice(index, 1);
  }
  return missing;
}
