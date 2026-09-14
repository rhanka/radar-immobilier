import { graphlib } from 'dagre-d3-es';
import { layout } from 'dagre-d3-es/src/dagre/layout.js';
import { routeEdge } from '/kit/src/architecture-routing.js';

// Baseline geometry contract (codex-13-sept dossier): rankdir LR, real nested
// parent boxes, recursive Dagre placement. Only the card box is compacted.
const RANKDIR = 'LR';
// One owner-ratified card template (v10). Width 460 = 26 px of card chrome + a
// 70 px icon + 6 px gap + the widest role title measured in the document font
// (356.4 px, « Planification · absente »); the widest full-width line is the
// detail « transactionnel · seule exception » at 355.7 px. Height 200 = 70.2
// (icon and the two first lines) + 6 + 31.2 + 31.2 + 9 (filet) + 31.2 + 20.
export const CARD = { A: { width: 460, height: 200 } };
const SUBFLOW_HEADER_SPACE = 96;
// Retuned for the 460x200 card (v10): swept 24/32/40/48 against 72/88/104/120,
// every pair places all edge labels, and 24/72 is the smallest scene of the set
// (hosting 4376x1948 instead of 4600x2044 at 40/104).
const NODESEP = 24;
const RANKSEP = 72;
const NESTED_MARGIN = 24;
const ROOT_MARGIN = 48;

const titleOf = item => item.label.split('\n')[0];

const overlaps = (left, right, padding = 0) => left.left < right.right + padding
  && left.right > right.left - padding && left.top < right.bottom + padding && left.bottom > right.top - padding;
const boxAt = (point, width, height) => ({ left: point.x - width / 2, right: point.x + width / 2,
  top: point.y - height / 2, bottom: point.y + height / 2 });
function placeLabels(edges, nodes, headers, bounds) {
  const nodeBoxes = [...nodes.map(node => ({ left: node.position.x, right: node.position.x + node.width,
    top: node.position.y, bottom: node.position.y + node.height })), ...headers];
  const placed = [];
  return edges.map(edge => {
    if (!edge.label) return edge;
    const width = Math.min(440, Math.max(80, edge.label.length * 12 + 18));
    const height = Math.ceil((edge.label.length * 12 + 18) / 440) * 30;
    const segments = edge.data.routedPoints.slice(1).map((point, index) => ({ from: edge.data.routedPoints[index], to: point }))
      .sort((left, right) => (Math.abs(right.to.x - right.from.x) + Math.abs(right.to.y - right.from.y))
        - (Math.abs(left.to.x - left.from.x) + Math.abs(left.to.y - left.from.y)));
    let selection = null;
    for (const segment of segments) {
      for (const fraction of [.5, .38, .62, .26, .74, .14, .86, .08, .92]) {
        const anchor = { x: segment.from.x + (segment.to.x - segment.from.x) * fraction,
          y: segment.from.y + (segment.to.y - segment.from.y) * fraction };
        const horizontal = segment.from.y === segment.to.y;
        // Cards are narrower than in v8, so a clear corridor can sit further from
        // the route; the ladder reaches deeper before the placement is refused.
        const candidates = [0, 14, 34, 60, 94, 136, 188, 250, 322, 404, 496, 598].flatMap(offset => horizontal
          ? [{ x: anchor.x, y: anchor.y - height / 2 - offset }, { x: anchor.x, y: anchor.y + height / 2 + offset }]
          : [{ x: anchor.x - width / 2 - offset, y: anchor.y }, { x: anchor.x + width / 2 + offset, y: anchor.y }]);
        selection = candidates.map(point => ({ point, box: boxAt(point, width, height) }))
          .find(candidate => candidate.box.left >= bounds.left && candidate.box.top >= bounds.top
            && candidate.box.right <= bounds.right && candidate.box.bottom <= bounds.bottom
            && !nodeBoxes.some(box => overlaps(candidate.box, box, 4))
            && !placed.some(box => overlaps(candidate.box, box, 4)));
        if (selection) break;
      }
      if (selection) break;
    }
    if (!selection) throw Error(`No node-clear label placement for ${edge.id}`);
    placed.push(selection.box);
    return { ...edge, data: { ...edge.data, labelPoint: selection.point, labelBox: selection.box } };
  });
}

// Each Mermaid subgraph stays a real parent box, never a replacement for its leaves.
export function sceneFor(graph) {
  const all = new Map([...graph.groups, ...graph.nodes].map(item => [item.id, item]));
  const groupIds = new Set(graph.groups.map(group => group.id));
  const dimensions = new Map();
  const positions = new Map();
  const representative = (id, parent) => {
    let item = all.get(id);
    while (item && item.parent !== parent) item = all.get(item.parent);
    return item?.id;
  };

  function arrange(parent = null) {
    const children = [...all.values()].filter(item => item.parent === parent);
    for (const child of children) {
      dimensions.set(child.id, groupIds.has(child.id) ? arrange(child.id) : { ...CARD[child.metadata.card] });
    }
    const margin = parent ? NESTED_MARGIN : ROOT_MARGIN;
    const dag = new graphlib.Graph({ multigraph: true })
      .setGraph({ rankdir: RANKDIR, nodesep: NODESEP, ranksep: RANKSEP, marginx: margin, marginy: margin })
      .setDefaultEdgeLabel(() => ({}));
    for (const child of children) dag.setNode(child.id, dimensions.get(child.id));
    for (const edge of graph.edges) {
      const source = representative(edge.source, parent);
      const target = representative(edge.target, parent);
      if (source && target && source !== target) dag.setEdge(source, target, {}, edge.id);
    }
    layout(dag);
    const width = dag.graph().width ?? 0;
    const height = (dag.graph().height ?? 0) + (parent ? SUBFLOW_HEADER_SPACE : 0);
    for (const child of children) {
      const point = dag.node(child.id), size = dimensions.get(child.id);
      positions.set(child.id, { x: point.x - size.width / 2,
        y: point.y - size.height / 2 + (parent ? SUBFLOW_HEADER_SPACE : 0) });
    }
    if (parent) {
      // The compact header must fit inside the box Dagre produced; otherwise the
      // title would be clipped and the box would silently lose information.
      const headerWidth = titleOf(all.get(parent)).length * 17 + 150;
      if (headerWidth > width) throw Error(`${graph.id}/${parent}: header ${Math.ceil(headerWidth)}px exceeds box ${width}px`);
    }
    return { width, height };
  }

  const canvas = arrange();
  const nodes = [];
  const absolute = new Map();
  function emit(parent = null, origin = { x: 0, y: 0 }, depth = 0) {
    for (const item of all.values()) {
      if (item.parent !== parent) continue;
      const group = groupIds.has(item.id);
      const position = positions.get(item.id);
      const size = dimensions.get(item.id);
      const globalPosition = { x: origin.x + position.x, y: origin.y + position.y };
      const meta = item.metadata;
      const provenance = { ...meta, service: titleOf(item), repoLabel: `repo: ${meta.repo.join(' + ')}` };
      const node = {
        id: item.id, type: group ? 'subflow' : 'architecture', ...size, position,
        ...(parent ? { parentId: parent, extent: 'parent' } : {}), zIndex: group ? depth : 10,
        data: {
          kind: meta.kind, title: titleOf(item), card: meta.card, code: meta.code, roleTitle: meta.role, name: meta.name, detail: meta.detail,
          entity: item, group, depth, label: item.label, provenance, parentId: item.parent,
          evidenceClass: meta.evidenceClass, runtimeState: meta.runtimeState,
        },
      };
      nodes.push(node);
      absolute.set(item.id, { ...node, position: globalPosition });
      if (group) emit(item.id, globalPosition, depth + 1);
    }
  }
  emit();

  const leaves = [...absolute.values()].filter(node => !node.data.group);
  const unrouted = graph.edges.map(edge => ({
    id: edge.id, source: edge.source, target: edge.target, label: edge.label,
    originalSource: edge.source, originalTarget: edge.target, type: 'architecture', zIndex: 20,
    data: {
      source: edge.source, target: edge.target, label: edge.label, dashed: edge.dashed, both: edge.both,
      evidenceClass: edge.metadata.evidenceClass, runtimeState: edge.metadata.runtimeState,
    },
    markerEnd: { type: 'arrowclosed' }, ...(edge.both ? { markerStart: { type: 'arrowclosed' } } : {}),
    style: `stroke:var(--st-semantic-text-secondary);stroke-width:3;${edge.dashed ? 'stroke-dasharray:10 7' : ''}`,
  }));
  // Container headers carry the box title, status and repo, so a route label may
  // not land on them either.
  const headers = [...absolute.values()].filter(node => node.data.group)
    .map(node => ({ left: node.position.x, right: node.position.x + node.width,
      top: node.position.y, bottom: node.position.y + SUBFLOW_HEADER_SPACE }));
  const edges = placeLabels(unrouted.map(edge => routeEdge(edge, leaves, [], unrouted)), leaves, headers,
    { left: -24, top: -24, right: canvas.width + 24, bottom: canvas.height + 24 });
  return { nodes, edges, absoluteNodes: [...absolute.values()], canvas };
}
