// Build-time geometry of the table (ER) and swimlane scenes. Positions come from an
// explicit grid (column, row) given by diagram-specs.js; edges are routed by
// diagram-router.js. Everything is in canvas pixels at scale 1.
import { routeEdges, placeLabels, textWidth } from './diagram-router.js';

// ER: header line, then one line per column; monospace text.
export const ER = { header: 36, line: 24, padX: 12, mono: 0.62, nameSize: 15, columnSize: 13, colGap: 120, rowGap: 72, band: 64, margin: 40 };

const columnText = attribute => `${attribute.keys.join(',').padEnd(6)} ${attribute.name}`;
const columnNote = attribute => attribute.comment ? ` · ${attribute.comment}` : '';

export function erLayout(model, spec) {
  const placement = spec.placement;
  const colGap = spec.colGap ?? ER.colGap;
  for (const entity of model.entities) if (!placement[entity.id]) throw Error(`er: no placement for ${entity.id}`);
  for (const id of Object.keys(placement)) if (!model.entities.some(entity => entity.id === id)) throw Error(`er: placement for unknown ${id}`);
  const size = Object.fromEntries(model.entities.map(entity => {
    // Room for the status tag, and for the owner badge when the diagram carries one.
    const widest = Math.max(textWidth(entity.id, ER.nameSize, ER.mono) + (spec.owner?.[entity.id] ? 250 : 96),
      ...entity.attributes.map(attribute => textWidth(`${attribute.type.padEnd(11)} ${columnText(attribute)}${columnNote(attribute)}`, ER.columnSize, ER.mono)));
    return [entity.id, { width: widest + ER.padX * 2, height: ER.header + entity.attributes.length * ER.line + 8 }];
  }));
  const columns = Math.max(...Object.values(placement).map(place => place.col)) + 1;
  const rows = Math.max(...Object.values(placement).map(place => place.row)) + 1;
  const colWidth = Array.from({ length: columns }, (_, col) => Math.max(...model.entities.filter(entity => placement[entity.id].col === col).map(entity => size[entity.id].width)));
  const rowHeight = Array.from({ length: rows }, (_, row) => Math.max(0, ...model.entities.filter(entity => placement[entity.id].row === row).map(entity => size[entity.id].height)));
  const colX = colWidth.reduce((list, width, index) => [...list, index ? list[index - 1] + colWidth[index - 1] + colGap : ER.margin], []);
  const rowY = rowHeight.reduce((list, height, index) => [...list, index ? list[index - 1] + rowHeight[index - 1] + ER.rowGap : ER.margin + ER.band], []);
  const boxes = model.entities.map(entity => {
    const { col, row } = placement[entity.id];
    return { id: entity.id, x: colX[col] + Math.round((colWidth[col] - size[entity.id].width) / 2), y: rowY[row], ...size[entity.id] };
  });
  const width = colX.at(-1) + colWidth.at(-1) + ER.margin;
  const height = rowY.at(-1) + rowHeight.at(-1) + ER.margin + 20;
  if (spec.layers.length !== columns) throw Error(`er: ${spec.layers.length} layers for ${columns} columns`);
  // One background band per column (layer of the model), touching its neighbours.
  const layers = spec.layers.map((title, col) => {
    const left = col ? colX[col] - colGap / 2 : 8;
    const right = col < columns - 1 ? colX[col] + colWidth[col] + colGap / 2 : width - 8;
    return { title, x: left + 3, y: 8, width: right - left - 6, height: height - 16 };
  });
  const edges = model.relations.map(relation => ({ id: relation.id, source: relation.source, target: relation.target, label: spec.labels[relation.label] ?? relation.label.replaceAll('_', ' ') }));
  const routes = routeEdges(boxes, edges, { width, height, clearance: 30 });
  const labels = placeLabels(routes, edges, boxes, { size: 13, width, height });
  return { width, height, boxes, layers, routes, labels };
}

// Swimlanes: vertical lanes left to right, each lane a column of fixed-size nodes;
// optional containers inside a lane (S3, PostgreSQL); a transversal band at the bottom.
export const LANES = { node: { width: 270, height: 76 }, bandNode: { width: 240, height: 76 }, lanePad: 72, header: 96, rowGap: 64, bandGap: 84, bandHeader: 112, margin: 40, container: 30, zoneHeader: 56 };

export function laneLayout(graph, spec) {
  const laneIds = spec.lanes.map(lane => lane.id);
  const laneOf = id => {
    let node = graph.nodes.find(item => item.id === id) ?? graph.groups.find(item => item.id === id);
    while (node && !laneIds.includes(node.id) && node.id !== spec.band.id) node = graph.groups.find(group => group.id === node.parent);
    return node?.id;
  };
  const laneWidth = LANES.node.width + LANES.lanePad * 2;
  const rows = Math.max(...Object.values(spec.rows)) + 1;
  // An optional zone (title strip) wraps all the lanes: "Application" above the evaluation band.
  const top = LANES.margin + (spec.zone ? LANES.zoneHeader : 0);
  const rowY = row => top + LANES.header + row * (LANES.node.height + LANES.rowGap);
  const lanesBottom = rowY(rows) - LANES.rowGap + 28;
  const width = LANES.margin * 2 + laneWidth * spec.lanes.length;
  const boxes = [];
  for (const node of graph.nodes) {
    const lane = laneOf(node.id);
    if (lane === spec.band.id) continue;
    const col = laneIds.indexOf(lane);
    if (col < 0) throw Error(`lanes: ${node.id} is in no lane`);
    if (spec.rows[node.id] === undefined) throw Error(`lanes: no row for ${node.id}`);
    boxes.push({ id: node.id, lane, x: LANES.margin + col * laneWidth + LANES.lanePad, y: rowY(spec.rows[node.id]), ...LANES.node });
  }
  const bandNodes = graph.nodes.filter(node => laneOf(node.id) === spec.band.id);
  const bandY = lanesBottom + LANES.bandGap;
  const bandNode = { ...LANES.bandNode, ...(spec.band.nodeWidth ? { width: spec.band.nodeWidth } : {}) };
  // Band slots: one row in the given order, or explicit [column, row] places.
  const place = spec.band.place ?? Object.fromEntries(spec.band.order.map((id, index) => [id, [index, 0]]));
  const columns = Math.max(...Object.values(place).map(([col]) => col)) + 1;
  const bandRows = Math.max(...Object.values(place).map(([, row]) => row)) + 1;
  const bandSlot = (width - LANES.margin * 2) / columns;
  for (const node of spec.band.order) {
    if (!bandNodes.some(item => item.id === node) || !place[node]) throw Error(`lanes: band order names ${node}, not in the band`);
    const [col, row] = place[node];
    boxes.push({ id: node, lane: spec.band.id, x: Math.round(LANES.margin + bandSlot * col + (bandSlot - bandNode.width) / 2),
      y: bandY + LANES.bandHeader + row * (bandNode.height + LANES.rowGap), ...bandNode });
  }
  if (spec.band.order.length !== bandNodes.length) throw Error('lanes: band order incomplete');
  const height = bandY + LANES.bandHeader + bandRows * bandNode.height + (bandRows - 1) * LANES.rowGap + 36 + LANES.margin;
  const lanes = spec.lanes.map((lane, col) => ({ id: lane.id, kind: lane.kind, title: lane.title, x: LANES.margin + col * laneWidth, y: top, width: laneWidth, height: lanesBottom - top }));
  const band = { id: spec.band.id, subtitle: spec.band.subtitle, x: LANES.margin, y: bandY, width: width - LANES.margin * 2, height: height - LANES.margin - bandY };
  const zone = spec.zone ? { title: spec.zone.title, x: LANES.margin - 16, y: LANES.margin - 16, width: width - LANES.margin * 2 + 32, height: lanesBottom - LANES.margin + 32 } : null;
  const containers = graph.groups.filter(group => !laneIds.includes(group.id) && group.id !== spec.band.id).map(group => {
    const inner = boxes.filter(box => graph.nodes.find(node => node.id === box.id).parent === group.id);
    if (!inner.length) throw Error(`lanes: empty container ${group.id}`);
    const top = Math.min(...inner.map(box => box.y)), bottom = Math.max(...inner.map(box => box.y + box.height));
    const left = Math.min(...inner.map(box => box.x)), right = Math.max(...inner.map(box => box.x + box.width));
    return { id: group.id, x: left - 14, y: top - LANES.container - 6, width: right - left + 28, height: bottom - top + LANES.container + 20 };
  });
  // Band routing: neighbours in the band connect side to side; any other edge touching the
  // band leaves or enters it by the top, so no route runs below the band nodes.
  const inBand = id => laneOf(id) === spec.band.id;
  const sidesOf = edge => {
    const a = inBand(edge.source), b = inBand(edge.target);
    const [ca, ra] = a ? place[edge.source] : [], [cb, rb] = b ? place[edge.target] : [];
    // Side to side only when the gap between the two nodes can carry the label.
    const fits = textWidth(edge.label, 13) + 12 + 16 <= bandSlot - bandNode.width;
    if (a && b && ra === rb && Math.abs(ca - cb) === 1 && fits) {
      const forward = ca < cb;
      return { source: [forward ? 'right' : 'left'], target: [forward ? 'left' : 'right'] };
    }
    if (a || b) return { ...(a ? { source: ['top'] } : {}), ...(b ? { target: ['top'] } : {}) };
    return undefined;
  };
  const edges = graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label, sides: sidesOf(edge) }));
  // Containers are obstacles for routes that do not enter them: their title strip only.
  const strips = [...containers.map(container => ({ id: `strip:${container.id}`, x: container.x, y: container.y, width: container.width, height: LANES.container - 4 })),
    { id: 'strip:band-title', x: band.x, y: band.y, width: Math.min(band.width, spec.band.titleWidth), height: 52 },
    ...(zone ? [{ id: 'strip:zone-title', x: zone.x, y: zone.y, width: Math.min(zone.width, spec.zone.titleWidth), height: LANES.zoneHeader }] : [])];
  const routes = routeEdges([...boxes, ...strips], edges, { width, height });
  const labels = placeLabels(routes, edges, [...boxes, ...strips], { size: 13, width, height });
  return { width, height, boxes, lanes, band, zone, containers, routes, labels, legend: spec.legend };
}
