import { graphlib } from 'dagre-d3-es';
import { layout } from 'dagre-d3-es/src/dagre/layout.js';
import { routeEdge } from '/kit/src/architecture-routing.js';

// Each Mermaid subgraph is a real parent box, never a replacement for its leaves.
export function sceneFor(graph) {
  const all = new Map([...graph.groups, ...graph.nodes].map(n => [n.id, n]));
  const groupIds = new Set(graph.groups.map(g => g.id)), dimensions = new Map(), positions = new Map();
  const representative = (id, parent) => {
    let item = all.get(id);
    while (item && item.parent !== parent) item = all.get(item.parent);
    return item?.id;
  };
  function arrange(parent = null) {
    const children = [...all.values()].filter(n => n.parent === parent);
    for (const child of children) dimensions.set(child.id, groupIds.has(child.id) ? arrange(child.id) : { width: 290, height: 190 });
    const dag = new graphlib.Graph({ multigraph: true })
      .setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 160, marginx: 44, marginy: 44 }).setDefaultEdgeLabel(() => ({}));
    for (const child of children) dag.setNode(child.id, dimensions.get(child.id));
    for (const edge of graph.edges) {
      const source = representative(edge.source, parent), target = representative(edge.target, parent);
      if (source && target && source !== target) dag.setEdge(source, target, {}, edge.id);
    }
    layout(dag);
    for (const child of children) {
      const p = dag.node(child.id), size = dimensions.get(child.id);
      positions.set(child.id, { x: p.x - size.width / 2, y: p.y - size.height / 2 + (parent ? 64 : 0) });
    }
    return { width: Math.max(410, dag.graph().width ?? 0), height: Math.max(310, (dag.graph().height ?? 0) + 64) };
  }
  arrange();
  const nodes = [], absolute = new Map();
  function emit(parent = null, origin = { x: 0, y: 0 }, depth = 0) {
    for (const item of all.values()) {
      if (item.parent !== parent) continue;
      const group = groupIds.has(item.id), position = positions.get(item.id), size = dimensions.get(item.id);
      const globalPosition = { x: origin.x + position.x, y: origin.y + position.y };
      const node = { id: item.id, type: group ? 'subflow' : 'architecture', ...size, position,
        ...(parent ? { parentId: parent, extent: 'parent' } : {}), zIndex: group ? depth : 10,
        data: { kind: item.resource ?? (item.store ? 'STORE' : 'COMPOSANT'), title: item.label.split('\n')[0],
          function: item.label.split('\n')[1] ?? '', detail: item.label.split('\n').slice(2).join(' · '),
          tone: item.store ? 'data' : 'entry', statusLabel: 'Cliquer : identité, relations et autres vues',
          entity: item, group, depth, label: item.label } };
      nodes.push(node); absolute.set(item.id, { ...node, position: globalPosition });
      if (group) emit(item.id, globalPosition, depth + 1);
    }
  }
  emit();
  const leaves = [...absolute.values()].filter(n => !n.data.group);
  const edges = graph.edges.map(edge => ({ ...routeEdge(edge, leaves, [], graph.edges),
    originalSource: edge.source, originalTarget: edge.target, type: 'architecture', zIndex: 20,
    markerEnd: { type: 'arrowclosed' }, ...(edge.both ? { markerStart: { type: 'arrowclosed' } } : {}),
    style: `stroke:var(--st-semantic-text-secondary);stroke-width:2;${edge.dashed ? 'stroke-dasharray:7 5' : ''}` }));
  return { nodes, edges, absoluteNodes: [...absolute.values()] };
}
