// Orthogonal edge router for the table (ER) and swimlane scenes of this dossier.
// Sparse routing grid: candidate x and y lines come from the box sides (with a
// clearance), the middle of every free channel between boxes (with parallel tracks)
// and the ports. A* with a bend penalty and a reuse penalty, so two edges share a
// channel on separate tracks. Deterministic and dependency-free: it runs at build time.

const DEFAULT_CLEARANCE = 16;
const TRACK = 12;
const BEND = 60;
const REUSE = 400;
const CROSS = 30;
const PORT_REUSE = 500;
const OFF_CENTRE = 0.8;

const inside = (box, x, y, pad = 0) => x > box.x - pad && x < box.x + box.width + pad && y > box.y - pad && y < box.y + box.height + pad;
// Does an axis-aligned segment cross the open interior of a box?
const crosses = (box, x1, y1, x2, y2, pad) => {
  const left = box.x - pad, right = box.x + box.width + pad, top = box.y - pad, bottom = box.y + box.height + pad;
  if (x1 === x2) return x1 > left && x1 < right && Math.max(y1, y2) > top && Math.min(y1, y2) < bottom;
  return y1 > top && y1 < bottom && Math.max(x1, x2) > left && Math.min(x1, x2) < right;
};

// Port offsets along a side, from the middle outwards, kept clear of the corners.
const portOffsets = length => {
  const offsets = [0];
  for (let step = 18; step <= length / 2 - 14; step += 18) offsets.push(-step, step);
  return offsets;
};

function portsOf(box, CLEARANCE) {
  const ports = [];
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  for (const offset of portOffsets(box.width)) {
    ports.push({ side: 'top', offset, x: cx + offset, y: box.y, sx: cx + offset, sy: box.y - CLEARANCE });
    ports.push({ side: 'bottom', offset, x: cx + offset, y: box.y + box.height, sx: cx + offset, sy: box.y + box.height + CLEARANCE });
  }
  for (const offset of portOffsets(box.height)) {
    ports.push({ side: 'left', offset, x: box.x, y: cy + offset, sx: box.x - CLEARANCE, sy: cy + offset });
    ports.push({ side: 'right', offset, x: box.x + box.width, y: cy + offset, sx: box.x + box.width + CLEARANCE, sy: cy + offset });
  }
  return ports;
}

// Channel tracks: the middle of each free interval between box boundaries, plus
// parallel tracks on both sides when the interval is wide enough.
function channelLines(boundaries, min, max) {
  const sorted = [...new Set(boundaries)].sort((a, b) => a - b);
  const lines = [];
  const all = [min, ...sorted, max];
  for (let index = 1; index < all.length; index++) {
    const low = all[index - 1], high = all[index], gap = high - low;
    if (gap <= 0) continue;
    const mid = Math.round((low + high) / 2);
    lines.push(mid);
    for (let track = TRACK; track < gap / 2 - 4; track += TRACK) lines.push(mid - track, mid + track);
  }
  return lines;
}

class Heap {
  constructor() { this.items = []; }
  push(item) {
    const items = this.items; items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent][0] <= items[index][0]) break;
      [items[parent], items[index]] = [items[index], items[parent]]; index = parent;
    }
  }
  pop() {
    const items = this.items, top = items[0], last = items.pop();
    if (items.length) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1, right = left + 1;
        let smallest = index;
        if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
        if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
        if (smallest === index) break;
        [items[smallest], items[index]] = [items[index], items[smallest]]; index = smallest;
      }
    }
    return top;
  }
  get size() { return this.items.length; }
}

const simplify = points => points.filter((point, index) => {
  if (index === 0 || index === points.length - 1) return true;
  const previous = points[index - 1], next = points[index + 1];
  return !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
}).filter((point, index, list) => index === 0 || point.x !== list[index - 1].x || point.y !== list[index - 1].y);

// boxes: [{ id, x, y, width, height }]; edges: [{ id, source, target, sides? }]
// (sides: { source: ['right', …], target: […] } restricts the ports used).
// Returns { [edgeId]: [{x, y}, …] }: port on the source side, then the route, then the
// port on the target side. Self edges get a fixed loop on the top-right corner.
export function routeEdges(boxes, edges, { width, height, clearance: CLEARANCE = DEFAULT_CLEARANCE } = {}) {
  const byId = Object.fromEntries(boxes.map(box => [box.id, box]));
  const extent = {
    width: width ?? Math.max(...boxes.map(box => box.x + box.width)) + 80,
    height: height ?? Math.max(...boxes.map(box => box.y + box.height)) + 80,
  };
  const ports = Object.fromEntries(boxes.map(box => [box.id, portsOf(box, CLEARANCE)]));
  const xs = new Set(channelLines(boxes.flatMap(box => [box.x - CLEARANCE, box.x + box.width + CLEARANCE]), 4, extent.width - 4));
  const ys = new Set(channelLines(boxes.flatMap(box => [box.y - CLEARANCE, box.y + box.height + CLEARANCE]), 4, extent.height - 4));
  for (const box of boxes) {
    xs.add(box.x - CLEARANCE); xs.add(box.x + box.width + CLEARANCE);
    ys.add(box.y - CLEARANCE); ys.add(box.y + box.height + CLEARANCE);
    for (const port of ports[box.id]) { xs.add(port.sx); ys.add(port.sy); }
  }
  const X = [...xs].filter(x => x > 0 && x < extent.width).sort((a, b) => a - b);
  const Y = [...ys].filter(y => y > 0 && y < extent.height).sort((a, b) => a - b);
  const free = (x, y) => !boxes.some(box => inside(box, x, y, CLEARANCE - 1));
  const key = (i, j) => i * Y.length + j;
  const xIndex = new Map(X.map((x, i) => [x, i])), yIndex = new Map(Y.map((y, j) => [y, j]));
  const usedSegments = new Map(); // "i,j|i2,j2" -> count
  const usedPorts = new Set();
  const drawn = []; // segments of routed edges, for crossing penalties
  const segmentKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const blocked = new Map();
  const segmentFree = (i1, j1, i2, j2) => {
    const k = segmentKey(key(i1, j1), key(i2, j2));
    if (!blocked.has(k)) blocked.set(k, !boxes.some(box => crosses(box, X[i1], Y[j1], X[i2], Y[j2], CLEARANCE - 1)));
    return blocked.get(k);
  };
  const crossingsOf = (x1, y1, x2, y2) => drawn.reduce((count, [a, b]) => {
    if (x1 === x2 && a.y === b.y) return count + (x1 > Math.min(a.x, b.x) && x1 < Math.max(a.x, b.x) && a.y > Math.min(y1, y2) && a.y < Math.max(y1, y2) ? 1 : 0);
    if (y1 === y2 && a.x === b.x) return count + (y1 > Math.min(a.y, b.y) && y1 < Math.max(a.y, b.y) && a.x > Math.min(x1, x2) && a.x < Math.max(x1, x2) ? 1 : 0);
    return count;
  }, 0);

  const routes = {};
  for (const edge of edges) {
    const source = byId[edge.source], target = byId[edge.target];
    if (!source || !target) throw Error(`route ${edge.id}: unknown endpoint`);
    if (edge.source === edge.target) {
      const right = source.x + source.width, top = source.y;
      routes[edge.id] = [{ x: right - 36, y: top }, { x: right - 36, y: top - 30 }, { x: right + 34, y: top - 30 },
        { x: right + 34, y: top + 36 }, { x: right, y: top + 36 }];
      continue;
    }
    const allowed = (list, port) => !list || list.includes(port.side);
    const starts = ports[source.id].filter(port => allowed(edge.sides?.source, port) && free(port.sx, port.sy));
    const goals = new Map();
    for (const port of ports[target.id]) if (allowed(edge.sides?.target, port) && free(port.sx, port.sy)) goals.set(key(xIndex.get(port.sx), yIndex.get(port.sy)), port);
    // State: grid node + incoming direction (0 none, 1 horizontal, 2 vertical).
    const best = new Map(), previous = new Map(), heap = new Heap();
    const heuristic = (i, j) => Math.min(...[...goals.values()].map(port => Math.abs(X[i] - port.sx) + Math.abs(Y[j] - port.sy)));
    for (const port of starts) {
      const i = xIndex.get(port.sx), j = yIndex.get(port.sy);
      const direction = port.side === 'left' || port.side === 'right' ? 1 : 2;
      const cost = CLEARANCE + Math.abs(port.offset) * OFF_CENTRE + (usedPorts.has(`${source.id}:${port.x},${port.y}`) ? PORT_REUSE : 0);
      const state = `${key(i, j)}:${direction}`;
      if (cost < (best.get(state) ?? Infinity)) { best.set(state, cost); previous.set(state, { port }); heap.push([cost + heuristic(i, j), cost, i, j, direction]); }
    }
    let reached = null;
    while (heap.size) {
      const [estimate, cost, i, j, direction] = heap.pop();
      if (reached && estimate >= reached.total) break;
      const state = `${key(i, j)}:${direction}`;
      if (cost > best.get(state)) continue;
      const goal = goals.get(key(i, j));
      if (goal) {
        const arriving = goal.side === 'left' || goal.side === 'right' ? 1 : 2;
        const total = cost + CLEARANCE + Math.abs(goal.offset) * OFF_CENTRE + (arriving !== direction ? BEND : 0) + (usedPorts.has(`${target.id}:${goal.x},${goal.y}`) ? PORT_REUSE : 0);
        if (!reached || total < reached.total) reached = { total, state, goal };
      }
      for (const [di, dj, nextDirection] of [[1, 0, 1], [-1, 0, 1], [0, 1, 2], [0, -1, 2]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= X.length || nj >= Y.length) continue;
        if (!free(X[ni], Y[nj]) || !segmentFree(i, j, ni, nj)) continue;
        const length = Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j]);
        const reuse = usedSegments.get(segmentKey(key(i, j), key(ni, nj))) ?? 0;
        const step = length + (direction && direction !== nextDirection ? BEND : 0) + reuse * REUSE
          + crossingsOf(X[i], Y[j], X[ni], Y[nj]) * CROSS;
        const nextState = `${key(ni, nj)}:${nextDirection}`;
        const nextCost = cost + step;
        if (nextCost < (best.get(nextState) ?? Infinity)) {
          best.set(nextState, nextCost); previous.set(nextState, { state, i, j });
          heap.push([nextCost + heuristic(ni, nj), nextCost, ni, nj, nextDirection]);
        }
      }
    }
    if (!reached) throw Error(`route ${edge.id}: no orthogonal path`);
    const grid = [];
    let state = reached.state, startPort = null;
    for (;;) {
      const [nodeKey] = state.split(':').map(Number);
      grid.push({ x: X[Math.floor(nodeKey / Y.length)], y: Y[nodeKey % Y.length] });
      const back = previous.get(state);
      if (back.port) { startPort = back.port; break; }
      state = back.state;
    }
    grid.reverse();
    for (let index = 1; index < grid.length; index++) {
      const a = grid[index - 1], b = grid[index];
      const k = segmentKey(key(xIndex.get(a.x), yIndex.get(a.y)), key(xIndex.get(b.x), yIndex.get(b.y)));
      usedSegments.set(k, (usedSegments.get(k) ?? 0) + 1);
    }
    usedPorts.add(`${source.id}:${startPort.x},${startPort.y}`);
    usedPorts.add(`${target.id}:${reached.goal.x},${reached.goal.y}`);
    const points = simplify([{ x: startPort.x, y: startPort.y }, ...grid, { x: reached.goal.x, y: reached.goal.y }]);
    for (let index = 1; index < points.length; index++) drawn.push([points[index - 1], points[index]]);
    routes[edge.id] = points;
  }
  return routes;
}

// Approximate text width (px) for label boxes; the browser check measures the real one.
export const textWidth = (text, size, ratio = 0.56) => Math.ceil([...text].length * size * ratio);

const overlap = (a, b, pad = 0) => a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;

// One label per edge, centred on a segment long enough to carry it, clear of every
// box and of the labels already placed. Horizontal segments first, longest first.
export function placeLabels(routes, edges, boxes, { size = 14, padX = 6, padY = 3, width: canvasWidth = Infinity, height: canvasHeight = Infinity } = {}) {
  const placed = [], labels = {};
  for (const edge of edges) {
    if (!edge.label) continue;
    const points = routes[edge.id];
    const width = textWidth(edge.label, size) + padX * 2, height = size + padY * 2 + 2;
    const candidates = [];
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      for (const at of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const x = a.x + (b.x - a.x) * at, y = a.y + (b.y - a.y) * at;
        const horizontal = a.y === b.y;
        const centred = Math.abs(at - 0.5) * 200;
        if (horizontal && length >= width + 8) candidates.push({ box: { x: x - width / 2, y: y - height / 2, width, height }, score: centred - length });
        // Beside the line: above or below a short horizontal segment, left or right of a vertical one.
        if (horizontal) for (const dy of [-height / 2 - 4, height / 2 + 4]) candidates.push({ box: { x: x - width / 2, y: y + dy - height / 2, width, height }, score: 2000 + centred - length });
        else for (const dx of [6, -6 - width]) candidates.push({ box: { x: x + dx, y: y - height / 2, width, height }, score: 1000 + centred - length + (dx < 0 ? 50 : 0) });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    const within = box => box.x >= 4 && box.y >= 4 && box.x + box.width <= canvasWidth - 4 && box.y + box.height <= canvasHeight - 4;
    const choice = candidates.find(candidate => within(candidate.box) && !boxes.some(box => overlap(candidate.box, box, 4)) && !placed.some(other => overlap(candidate.box, other, 2)))
      ?? candidates.find(candidate => within(candidate.box)) ?? candidates[0];
    if (!choice) throw Error(`label ${edge.id}: no segment`);
    placed.push(choice.box);
    labels[edge.id] = { ...choice.box, text: edge.label };
  }
  return labels;
}
