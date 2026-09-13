import { graphlib } from 'dagre-d3-es';
import { layout } from 'dagre-d3-es/src/dagre/layout.js';

export function sceneFor(graph, scope = null) {
  const all = new Map([...graph.groups, ...graph.nodes].map(n => [n.id, n]));
  const groups = new Set(graph.groups.map(g => g.id));
  const inside = id => {
    for (let item = all.get(id); item; item = all.get(item.parent)) if (item.parent === scope) return true;
    return false;
  };
  const representative = id => {
    let item = all.get(id);
    if (!inside(id)) return id;
    while (item.parent !== scope) item = all.get(item.parent);
    return item.id;
  };
  const visible = new Map([...all.values()].filter(n => n.parent === scope).map(n => [n.id, n]));
  const edges = [];
  for (const edge of graph.edges) {
    if (!inside(edge.source) && !inside(edge.target)) continue;
    const source = representative(edge.source), target = representative(edge.target);
    if (source === target) continue;
    visible.set(source, all.get(source)); visible.set(target, all.get(target));
    edges.push({ ...edge, source, target, originalSource: edge.source, originalTarget: edge.target });
  }
  const width = 290, height = 190;
  const dag = new graphlib.Graph({ multigraph: true }).setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 210, marginx: 50, marginy: 60 }).setDefaultEdgeLabel(() => ({}));
  const internal = [...visible.values()].filter(n => n.parent === scope);
  for (const item of internal) dag.setNode(item.id, { width, height });
  for (const e of edges) if (dag.hasNode(e.source) && dag.hasNode(e.target)) dag.setEdge(e.source, e.target, {}, e.id);
  layout(dag);
  const frameWidth = Math.max(600, dag.graph().width ?? 600), frameHeight = Math.max(350, dag.graph().height ?? 350);
  let externalIndex = 0;
  const nodes = [...visible.values()].map(item => {
    const local = item.parent === scope;
    const p = local ? dag.node(item.id) : { x: frameWidth + 380, y: 140 + externalIndex++ * (height + 95) };
    return { id: item.id, type: 'architecture', width, height, position: { x: p.x - width / 2, y: p.y - height / 2 },
      ...(scope && local ? { parentId: 'scope-frame', extent: 'parent' } : {}),
      data: { kind: groups.has(item.id) ? `SOUS-FLOW · ${[...all.values()].filter(n => n.parent === item.id).length} éléments` : `${item.resource ?? (item.store ? 'STORE' : 'COMPOSANT')}${local ? '' : ' · LIEN EXTERNE'}`,
        title: item.label.split('\n')[0], function: item.label.split('\n')[1] ?? '',
        detail: item.label.split('\n').slice(2).join(' · '), tone: groups.has(item.id) ? 'core' : item.store ? 'data' : local ? 'entry' : 'infra',
        statusLabel: groups.has(item.id) ? 'Cliquer pour ouvrir le sous-flow' : 'Cliquer : identité, relations et autres vues', entity: item, group: groups.has(item.id) } };
  });
  if (scope) nodes.unshift({ id: 'scope-frame', type: 'group', position: { x: 0, y: 0 }, data: { label: '' },
    width: frameWidth, height: frameHeight, style: `width:${frameWidth}px;height:${frameHeight}px`, selectable: false });
  return { nodes, edges: edges.map(e => ({ ...e, type: 'smoothstep',
    sourceHandle: 'source-right-4', targetHandle: 'target-left-4',
    markerEnd: { type: 'arrowclosed' }, ...(e.both ? { markerStart: { type: 'arrowclosed' } } : {}),
    style: `stroke:var(--st-semantic-text-secondary);stroke-width:2;${e.dashed ? 'stroke-dasharray:7 5' : ''}`,
    labelStyle: { fontSize: 12, fontWeight: 600 }, labelBgPadding: [8, 5],
    labelBgStyle: { fill: 'var(--st-semantic-surface-default)' } })) };
}
