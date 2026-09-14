import { graphlib } from 'dagre-d3-es';
import { layout } from 'dagre-d3-es/src/dagre/layout.js';
const SUBFLOW_HEADER_SPACE = 104;
const CARD = { width: 640, height: 144 };
const compactTitles = {
  A_CAPACITY: 'Capacité OVH observée', A_CLIENTS: 'Clients stockage graphe/scrape', A_DOCS: 'OVH S3 · documents canoniques',
  B_IDENTITY: 'Identité workload / keyring', B_OPERATOR: 'Opérateur / configuration',
  B_VALIDATE: 'Validation Signal/PDF', B_GRAPH: 'Graphe canonique publié', B_MODEL: 'Modèle M1 · en attente',
};
const compactTitle = item => item.id.endsWith('_TEM') ? 'SCW TEM · exception résiduelle'
  : compactTitles[item.id] ?? item.label.split(' · ')[0];

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
    // Dagre mutates node dimensions with x/y; every leaf must own its object.
    for (const child of children) dimensions.set(child.id, groupIds.has(child.id) ? arrange(child.id) : { ...CARD });
    const dag = new graphlib.Graph({ multigraph: true })
      .setGraph({ rankdir: 'LR', nodesep: 84, ranksep: 180, marginx: 20, marginy: 20 }).setDefaultEdgeLabel(() => ({}));
    for (const child of children) dag.setNode(child.id, dimensions.get(child.id));
    for (const edge of graph.edges) {
      const source = representative(edge.source, parent), target = representative(edge.target, parent);
      if (source && target && source !== target) dag.setEdge(source, target, {}, edge.id);
    }
    layout(dag);
    for (const child of children) {
      const p = dag.node(child.id), size = dimensions.get(child.id);
      positions.set(child.id, { x: p.x - size.width / 2, y: p.y - size.height / 2 + (parent ? SUBFLOW_HEADER_SPACE : 0) });
    }
    const headerWidth = parent ? compactTitle(all.get(parent)).length * 18 + 180 : 0;
    return { width: Math.max(headerWidth, dag.graph().width ?? 0), height: (dag.graph().height ?? 0) + SUBFLOW_HEADER_SPACE };
  }
  arrange();
  const nodes = [], absolute = new Map();
  function emit(parent = null, origin = { x: 0, y: 0 }, depth = 0) {
    for (const item of all.values()) {
      if (item.parent !== parent) continue;
      const group = groupIds.has(item.id), position = positions.get(item.id), size = dimensions.get(item.id);
      const globalPosition = { x: origin.x + position.x, y: origin.y + position.y };
      const meta = item.metadata;
      const provenance = { ...meta, service: item.label.split('\n')[0], repoLabel: `repo: ${meta.repo.join(' + ')}` };
      const node = { id: item.id, type: group ? 'subflow' : 'architecture', ...size, position,
        ...(parent ? { parentId: parent, extent: 'parent' } : {}), zIndex: group ? depth : 10,
        data: { kind: meta.kind, title: compactTitle(item), statusLabel: `${meta.evidenceClass} · ${meta.runtimeState}`,
          entity: item, group, depth, label: item.label, provenance, parentId: item.parent,
          evidenceClass: meta.evidenceClass, runtimeState: meta.runtimeState } };
      nodes.push(node); absolute.set(item.id, { ...node, position: globalPosition });
      if (group) emit(item.id, globalPosition, depth + 1);
    }
  }
  emit();
  const edges = graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target,
    label: edge.label, originalSource: edge.source, originalTarget: edge.target, type: 'architecture', zIndex: 20,
    data: { source: edge.source, target: edge.target, label: edge.label, dashed: edge.dashed, both: edge.both,
      evidenceClass: edge.metadata.evidenceClass, runtimeState: edge.metadata.runtimeState },
    markerEnd: { type: 'arrowclosed' }, ...(edge.both ? { markerStart: { type: 'arrowclosed' } } : {}),
    style: `stroke:var(--st-semantic-text-secondary);stroke-width:4;${edge.dashed ? 'stroke-dasharray:12 8' : ''}`,
    labelStyle: 'font-size:24px;fill:var(--st-semantic-text-primary)', labelBgPadding: [8, 5] }));
  return { nodes, edges, absoluteNodes: [...absolute.values()] };
}
