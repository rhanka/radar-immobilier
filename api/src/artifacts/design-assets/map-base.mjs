/**
 * Artifact map base (I-4) — worker-free Canvas 2D vector renderer.
 *
 * Engine-independent API over caller-supplied GeoJSON: neutral background,
 * two vector sources (zones, lots) plus optional municipal outlines, paint
 * through simple caller expressions, click/hover events, zoom and fit.
 *
 * Hard constraints (release CSP keeps `worker-src 'none'`):
 * - no background threads of any kind, no `blob:` URLs;
 * - no inline presentation attributes and no injected stylesheet elements:
 *   layout comes only from the external kit stylesheet (`map-base.css`),
 *   SVG presentation attributes and canvas bitmap attributes. This module
 *   never assigns element inline styles;
 * - no external tile, glyph or font fetch by default: the basemap and labels
 *   template hooks stay unset (`null`) until I-10 fills them with the
 *   same-origin tile paths. The only network the module can ever emit is
 *   same-origin tile images once a template was explicitly configured.
 *   Tile attribution stays page-owned: the page renders it (kit class
 *   `map-base-attribution`) from `getAttribution()` / the guide entries.
 *
 * Coordinate model: equirectangular projection around the fitted bounds
 * (adequate for single-city extents). Zoom is a continuous scale factor
 * held in the view; the page drives it through `zoomIn`/`zoomOut`/`setView`
 * or the built-in wheel/drag gestures.
 */

/** Default neutral background, used when the page supplies no paint. */
export const NEUTRAL_BACKGROUND = "#eef0ea";

/** Layers in draw order (first drawn first, last hit-tested first). */
const LAYER_ORDER = ["outlines", "zones", "lots"];

/**
 * Paint expression for one layer.
 * A color is either a literal CSS color string, a predicate function of the
 * feature properties, or a `{ property, stops, fallback }` lookup table.
 */
function resolveColor(expression, properties, fallback) {
  if (expression === undefined || expression === null) return fallback;
  if (typeof expression === "string") return expression;
  if (typeof expression === "function") {
    const value = expression(properties);
    return typeof value === "string" && value.length > 0 ? value : fallback;
  }
  if (typeof expression === "object") {
    const key = expression.property;
    const actual = key !== undefined && properties !== null && typeof properties === "object"
      ? properties[key]
      : undefined;
    const stops = Array.isArray(expression.stops) ? expression.stops : [];
    for (const stop of stops) {
      if (Array.isArray(stop) && stop.length === 2 && stop[0] === actual) return stop[1];
    }
    if (typeof expression.fallback === "string") return expression.fallback;
    return fallback;
  }
  return fallback;
}

/** Evaluate a layer paint rule against feature properties (pure, testable). */
export function evaluatePaint(rule, properties) {
  const safe = rule !== null && typeof rule === "object" ? rule : {};
  return {
    fill: resolveColor(safe.fill, properties, "rgba(0,0,0,0)"),
    stroke: resolveColor(safe.stroke, properties, "#3a3a3a"),
    lineWidth: typeof safe.lineWidth === "number" && safe.lineWidth > 0 ? safe.lineWidth : 1,
  };
}

/** Bounding box of a FeatureCollection as [minLon, minLat, maxLon, maxLat]. */
export function bboxOf(featureCollection) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const visit = (coordinates) => {
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      const [lon, lat] = coordinates;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const part of coordinates) visit(part);
  };
  const features = featureCollection !== null && typeof featureCollection === "object" &&
      Array.isArray(featureCollection.features)
    ? featureCollection.features
    : [];
  for (const feature of features) {
    if (feature !== null && typeof feature === "object" &&
      feature.geometry !== null && typeof feature.geometry === "object") {
      const geometry = feature.geometry;
      if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") visit(geometry.coordinates);
    }
  }
  if (minLon === Infinity) return null;
  return [minLon, minLat, maxLon, maxLat];
}

/** Ray-casting point-in-ring test over a single linear ring. */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function geometryContains(geometry, lon, lat) {
  if (geometry === null || typeof geometry !== "object") return false;
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    if (geometry.coordinates.length === 0) return false;
    if (!pointInRing(lon, lat, geometry.coordinates[0])) return false;
    for (let hole = 1; hole < geometry.coordinates.length; hole += 1) {
      if (pointInRing(lon, lat, geometry.coordinates[hole])) return false;
    }
    return true;
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.some((polygon) => geometryContains({ type: "Polygon", coordinates: polygon }, lon, lat));
  }
  return false;
}

/**
 * Topmost feature at a lon/lat across layers (lots over zones over
 * outlines). Returns `{ layer, feature, index }` or `null`.
 */
export function findFeatureAt(sources, lon, lat) {
  for (let order = LAYER_ORDER.length - 1; order >= 0; order -= 1) {
    const layer = LAYER_ORDER[order];
    const features = sources[layer];
    if (!Array.isArray(features)) continue;
    for (let index = features.length - 1; index >= 0; index -= 1) {
      const feature = features[index];
      if (feature !== null && typeof feature === "object" &&
        geometryContains(feature.geometry, lon, lat)) {
        return { layer, feature, index };
      }
    }
  }
  return null;
}

function isFeatureCollection(value) {
  return value !== null && typeof value === "object" &&
    value.type === "FeatureCollection" && Array.isArray(value.features);
}

function featuresOf(value) {
  return isFeatureCollection(value) ? value.features : [];
}

/**
 * Reference zoom for the scale-relative mapping (tileZoomForScale).
 * I-10 keeps this value: it only maps the continuous skeleton zoom onto
 * integer tile levels, it never changes a served byte. Frames instead
 * derive their zoom from the visible ground resolution
 * (tileZoomForExtent), so a fitted province no longer renders z14.
 */
export const FIT_Z = 14;

/**
 * Usable zoom range in pixels per projected unit. City extents in degrees
 * fit around 1e4, so the ceiling must sit far above screen-pixel scales.
 */
export const MIN_SCALE = 1e-6;
export const MAX_SCALE = 1e12;

function clampScale(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Expand a validated `{z}/{x}/{y}` template (pure, testable). */
export function expandTemplate(template, z, x, y) {
  return template.split("{z}").join(String(z)).split("{x}").join(String(x)).split("{y}").join(String(y));
}

/** Standard XYZ tile index for a lon/lat at integer zoom (pure, testable). */
export function tileXY(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const clamped = Math.min(85.0511, Math.max(-85.0511, lat)) * (Math.PI / 180);
  const y = Math.min(n - 1, Math.max(0, Math.floor(
    ((1 - Math.log(Math.tan(clamped) + 1 / Math.cos(clamped)) / Math.PI) / 2) * n,
  )));
  return [x, y];
}

/** Northwest lon/lat corner of an XYZ tile (pure, testable). */
export function tileToLonLat(x, y, z) {
  const n = 2 ** z;
  const lon = ((x / n) * 360) - 180;
  const s = Math.PI * (1 - (2 * y) / n);
  const lat = Math.atan((Math.exp(s) - Math.exp(-s)) / 2) * (180 / Math.PI);
  return [lon, lat];
}

/** Every XYZ tile intersecting two lon/lat corners (pure, testable). */
export function tilesForBounds(corners, z) {
  const lons = corners.map((corner) => corner[0]);
  const lats = corners.map((corner) => corner[1]);
  const [x0, y0] = tileXY(Math.min(...lons), Math.max(...lats), z);
  const [x1, y1] = tileXY(Math.max(...lons), Math.min(...lats), z);
  const tiles = [];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) tiles.push([x, y]);
  }
  return tiles;
}

/**
 * Integer tile zoom served by the I-10A proxy (mirror of
 * api/src/artifacts/tile-proxy.ts TILE_MIN_ZOOM..TILE_MAX_ZOOM).
 * The skeleton clamps there so extreme zooms reuse the nearest served
 * level instead of emitting doomed 404s.
 */
export const MIN_TILE_ZOOM = 5;
export const MAX_TILE_ZOOM = 18;

/** Integer tile zoom for a view scale (pure, testable). */
export function tileZoomForScale(scale, fitScale) {
  if (!(scale > 0) || !(fitScale > 0)) return FIT_Z;
  return Math.min(MAX_TILE_ZOOM, Math.max(MIN_TILE_ZOOM, Math.round(FIT_Z + Math.log2(scale / fitScale))));
}

/**
 * Per-frame tile budget: a fitted province extent at z14 would enumerate
 * on the order of 1e5 tiles, one request each, blocking the main thread.
 * The frame zoom derives from the visible ground resolution instead, and
 * stepping down keeps every frame within this many tile requests.
 */
export const MAX_TILES_PER_FRAME = 96;

/**
 * Integer tile zoom from the real ground resolution of the visible
 * longitude span (pure, testable). A 256 px tile covers
 * `lonSpanVisible * 256 / viewportCssWidth` degrees while zoom z shows
 * `360 / 2 ** z` degrees per tile edge, hence
 * z = round(log2(360 * viewportCssWidth / (256 * lonSpanVisible))).
 * A province extent at desktop widths lands around z6-7, a city around
 * z13-15. Clamped to the proxy-served range.
 */
export function tileZoomForExtent(lonSpanVisible, viewportCssWidth) {
  if (!(lonSpanVisible > 0) || !(viewportCssWidth > 0)) return FIT_Z;
  const z = Math.round(Math.log2((360 * viewportCssWidth) / (256 * lonSpanVisible)));
  return Math.min(MAX_TILE_ZOOM, Math.max(MIN_TILE_ZOOM, z));
}

/** Tile count intersecting two lon/lat corners, without allocating (pure, testable). */
export function countTilesForBounds(corners, z) {
  const lons = corners.map((corner) => corner[0]);
  const lats = corners.map((corner) => corner[1]);
  const [x0, y0] = tileXY(Math.min(...lons), Math.max(...lats), z);
  const [x1, y1] = tileXY(Math.max(...lons), Math.min(...lats), z);
  return (Math.abs(x1 - x0) + 1) * (Math.abs(y1 - y0) + 1);
}

/**
 * Zoom and tile list for two visible lon/lat corners at a viewport width
 * (pure, testable). The zoom derives from the visible ground resolution,
 * then steps down while the frame exceeds the budget; the count is
 * recomputed arithmetically at each step, so more than the budget is
 * never enumerated. When even the minimum zoom exceeds the budget, the
 * frame carries no tiles and the vector layers still paint.
 */
export function tilesForView(corners, viewportCssWidth, maxTiles = MAX_TILES_PER_FRAME) {
  const lons = corners.map((corner) => corner[0]);
  const lonSpan = Math.max(...lons) - Math.min(...lons);
  let z = tileZoomForExtent(Math.max(1e-9, lonSpan), viewportCssWidth);
  const budget = maxTiles > 0 ? maxTiles : MAX_TILES_PER_FRAME;
  while (z > MIN_TILE_ZOOM && countTilesForBounds(corners, z) > budget) z -= 1;
  if (countTilesForBounds(corners, z) > budget) return { z, tiles: [] };
  return { z, tiles: tilesForBounds(corners, z) };
}

/**
 * Validate a same-origin tile template for the I-10 hook.
 * Only paths starting with a single `/` followed by a non-slash
 * character and carrying `{z}`, `{x}` and `{y}` are accepted, so a
 * configured basemap can never point at an off-origin host:
 * protocol-relative (`//host/...`), backslash (`/\host/...`, any `\`)
 * and absolute-URL forms are all refused. Every whitespace and control
 * character is refused as well — WHATWG URL parsing strips tab/newline
 * before analysis, turning e.g. `/\t/host/...` into `//host/...` — as
 * are percent-encoded slashes and backslashes (`%2F`, `%5C`).
 */
export function validateBasemapTemplate(template) {
  if (template === null || template === undefined) return null;
  if (typeof template !== "string") throw new Error("map-base: basemap template must be a string or null");
  if (template.length < 2 || template[0] !== "/" || template[1] === "/") {
    throw new Error("map-base: basemap template must be a same-origin path");
  }
  for (const character of template) {
    const code = character.codePointAt(0);
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || character === "\\" || /\s/.test(character)) {
      throw new Error("map-base: basemap template must be a same-origin path");
    }
  }
  if (/%(?:2f|5c)/i.test(template)) {
    throw new Error("map-base: basemap template must be a same-origin path");
  }
  if (!template.includes("{z}") || !template.includes("{x}") || !template.includes("{y}")) {
    throw new Error("map-base: basemap template must carry {z}, {x} and {y}");
  }
  return template;
}

/**
 * Create a map inside `container`. The container element keeps its own
 * markup and classes; this module only appends one `<canvas>` sized through
 * bitmap attributes and laid out by the external kit stylesheet.
 */
export function createMap(container, options) {
  if (!container || typeof container.appendChild !== "function") {
    throw new Error("map-base: container element is required");
  }
  const settings = options !== null && typeof options === "object" ? options : {};
  const documentNode = container.ownerDocument || (typeof document !== "undefined" ? document : null);
  if (!documentNode || typeof documentNode.createElement !== "function") {
    throw new Error("map-base: a DOM document is required");
  }
  const canvas = documentNode.createElement("canvas");
  canvas.setAttribute("data-map-base", "canvas");
  container.appendChild(canvas);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("map-base: Canvas 2D is unavailable");

  const state = {
    background: typeof settings.background === "string" ? settings.background : NEUTRAL_BACKGROUND,
    basemapTemplate: validateBasemapTemplate(settings.basemapTemplate ?? null),
    labelsTemplate: validateBasemapTemplate(settings.labelsTemplate ?? null),
    attribution: [],
    paint: { zones: {}, lots: {}, outlines: {} },
    sources: { outlines: [], zones: [], lots: [] },
    view: null,
    fitSize: null,
    touched: false,
    hover: null,
    selection: null,
    listeners: { click: new Set(), hover: new Set() },
    destroyed: false,
    tiles: new Map(),
  };
  if (settings.paint !== null && typeof settings.paint === "object") {
    for (const layer of LAYER_ORDER) {
      if (settings.paint[layer] !== undefined) state.paint[layer] = settings.paint[layer];
    }
  }

  const metrics = () => {
    const rect = container.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));
    const ratio = Math.min(3, Math.max(1, Math.floor(
      (typeof window !== "undefined" && window.devicePixelRatio) || 1,
    )));
    return { cssWidth, cssHeight, ratio };
  };

  const projectSetup = () => {
    const bounds = combinedBounds();
    if (!bounds) return null;
    const [minLon, minLat, maxLon, maxLat] = bounds;
    const meanLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const kx = Math.cos(meanLat) || 1;
    return { minLon, minLat, maxLon, maxLat, kx };
  };

  const combinedBounds = () => {
    let merged = null;
    for (const layer of LAYER_ORDER) {
      const box = bboxOf({ type: "FeatureCollection", features: state.sources[layer] });
      if (!box) continue;
      merged = merged === null ? box : [
        Math.min(merged[0], box[0]),
        Math.min(merged[1], box[1]),
        Math.max(merged[2], box[2]),
        Math.max(merged[3], box[3]),
      ];
    }
    return merged;
  };

  const ensureView = () => {
    if (state.view) return state.view;
    fitToBounds();
    return state.view;
  };

  const toScreen = (lon, lat, view, setup, width, height) => {
    const x = ((lon - setup.minLon) * setup.kx - view.cx) * view.scale + width / 2;
    const y = ((setup.maxLat - lat - view.cy) * view.scale + height / 2);
    return [x, y];
  };

  const toLonLat = (x, y, view, setup, width, height) => {
    const lon = (x - width / 2) / view.scale + view.cx;
    const lonValue = lon / setup.kx + setup.minLon;
    const lat = setup.maxLat - ((y - height / 2) / view.scale + view.cy);
    return [lonValue, lat];
  };

  const traceRing = (ring, view, setup, width, height) => {
    for (let i = 0; i < ring.length; i += 1) {
      const [x, y] = toScreen(ring[i][0], ring[i][1], view, setup, width, height);
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
  };

  const drawTileLayer = (template, prefix, view, setup, width, height, z, tiles, needed) => {
    for (const [tx, ty] of tiles) {
      const key = `${prefix}${z}/${tx}/${ty}`;
      needed.add(key);
      let entry = state.tiles.get(key);
      if (!entry) {
        const image = new Image();
        entry = { image, loaded: false, cancelled: false };
        state.tiles.set(key, entry);
        image.onload = () => {
          if (entry.cancelled || state.tiles.get(key) !== entry) return;
          entry.loaded = true;
          redraw();
        };
        image.onerror = () => {
          if (entry.cancelled || state.tiles.get(key) !== entry) return;
          entry.loaded = false;
        };
        image.src = expandTemplate(template, z, tx, ty);
        if (state.tiles.size > 256) {
          const oldest = state.tiles.keys().next();
          if (!oldest.done) state.tiles.delete(oldest.value);
        }
      }
      if (!entry.loaded) continue;
      const [west, north] = tileToLonLat(tx, ty, z);
      const [east, south] = tileToLonLat(tx + 1, ty + 1, z);
      const [ax, ay] = toScreen(west, north, view, setup, width, height);
      const [bx, by] = toScreen(east, south, view, setup, width, height);
      context.drawImage(entry.image, ax, ay, bx - ax, by - ay);
    }
  };

  const drawTiles = (view, setup, width, height) => {
    if (!state.basemapTemplate && !state.labelsTemplate) return;
    if (typeof Image !== "function") return;
    const corners = [
      toLonLat(0, 0, view, setup, width, height),
      toLonLat(width, height, view, setup, width, height),
    ];
    // Extent-derived zoom: a fitted province no longer enumerates z14.
    const { z, tiles } = tilesForView(corners, width);
    const needed = new Set();
    // Base first, labels over it (fallback-upstream legibility), vectors last.
    if (state.basemapTemplate) drawTileLayer(state.basemapTemplate, "", view, setup, width, height, z, tiles, needed);
    if (state.labelsTemplate) drawTileLayer(state.labelsTemplate, "labels/", view, setup, width, height, z, tiles, needed);
    // Drop loads from a previous view: detached entries may still settle,
    // but their handlers are cleared so they never redraw or requeue.
    for (const [key, entry] of state.tiles) {
      if (!needed.has(key)) {
        entry.cancelled = true;
        entry.image.onload = null;
        entry.image.onerror = null;
        state.tiles.delete(key);
      }
    }
  };

  const redraw = () => {
    if (state.destroyed) return;
    const { cssWidth, cssHeight, ratio } = metrics();
    if (canvas.width !== cssWidth * ratio || canvas.height !== cssHeight * ratio) {
      canvas.width = cssWidth * ratio;
      canvas.height = cssHeight * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = state.background;
    context.fillRect(0, 0, cssWidth, cssHeight);
    const setup = projectSetup();
    if (!setup) return;
    const view = ensureView();
    if (!view) return;
    drawTiles(view, setup, cssWidth, cssHeight);
    for (const layer of LAYER_ORDER) {
      for (const feature of state.sources[layer]) {
        const geometry = feature !== null && typeof feature === "object" ? feature.geometry : null;
        if (!geometry) continue;
        const polygons = geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.type === "MultiPolygon" ? geometry.coordinates : null;
        if (!polygons) continue;
        const properties = feature.properties !== null && typeof feature.properties === "object"
          ? feature.properties
          : {};
        const paint = evaluatePaint(state.paint[layer], properties);
        context.beginPath();
        for (const polygon of polygons) {
          for (const ring of polygon) traceRing(ring, view, setup, cssWidth, cssHeight);
        }
        const isHovered = state.hover !== null && state.hover.feature === feature;
        const isSelected = state.selection !== null && state.selection.feature === feature;
        if (paint.fill !== "rgba(0,0,0,0)") {
          context.fillStyle = paint.fill;
          context.fill();
        }
        context.strokeStyle = isSelected ? "#111111" : isHovered ? "#111111" : paint.stroke;
        context.lineWidth = (isSelected || isHovered) ? paint.lineWidth + 1 : paint.lineWidth;
        context.stroke();
      }
    }
  };

  const emit = (kind, payload) => {
    for (const callback of state.listeners[kind]) {
      try {
        callback(payload);
      } catch {
        /* Listener errors never break the map loop. */
      }
    }
  };

  const positionOf = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const pick = (event) => {
    const setup = projectSetup();
    const view = ensureView();
    if (!setup || !view) return null;
    const { cssWidth, cssHeight } = metrics();
    const [x, y] = positionOf(event);
    const [lon, lat] = toLonLat(x, y, view, setup, cssWidth, cssHeight);
    return { hit: findFeatureAt(state.sources, lon, lat), lon, lat };
  };

  const onClick = (event) => {
    const result = pick(event);
    const payload = result && result.hit
      ? { layer: result.hit.layer, feature: result.hit.feature, index: result.hit.index, lon: result.lon, lat: result.lat }
      : { layer: null, feature: null, index: -1, lon: result ? result.lon : null, lat: result ? result.lat : null };
    state.selection = result && result.hit ? result.hit : null;
    redraw();
    emit("click", payload);
  };

  let hoverQueued = false;
  const onHover = (event) => {
    if (hoverQueued) return;
    hoverQueued = true;
    const current = event;
    const run = () => {
      hoverQueued = false;
      if (state.destroyed) return;
      const result = pick(current);
      const next = result && result.hit ? result.hit : null;
      const changed = (next && next.feature) !== (state.hover && state.hover.feature);
      state.hover = next;
      if (changed) {
        redraw();
        emit("hover", next
          ? { layer: next.layer, feature: next.feature, index: next.index }
          : { layer: null, feature: null, index: -1 });
      }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else run();
  };

  const onLeave = () => {
    if (state.hover !== null) {
      state.hover = null;
      redraw();
      emit("hover", { layer: null, feature: null, index: -1 });
    }
  };

  const zoomAt = (factor, centerX, centerY) => {
    const view = ensureView();
    if (!view) return;
    const { cssWidth, cssHeight } = metrics();
    const anchorX = (centerX === undefined ? cssWidth / 2 : centerX) - cssWidth / 2;
    const anchorY = (centerY === undefined ? cssHeight / 2 : centerY) - cssHeight / 2;
    const next = clampScale(view.scale * factor);
    // Keep the projected point under the anchor fixed: the anchor offset
    // equals (point - center) * scale, so center' = center + dx/scale - dx/next.
    view.cx = view.cx + anchorX / view.scale - anchorX / next;
    view.cy = view.cy + anchorY / view.scale - anchorY / next;
    view.scale = next;
    state.touched = true;
    redraw();
  };

  const onWheel = (event) => {
    event.preventDefault();
    const [x, y] = positionOf(event);
    zoomAt(event.deltaY < 0 ? 1.25 : 0.8, x, y);
  };

  let dragging = null;
  const onPointerDown = (event) => {
    dragging = positionOf(event);
    if (typeof canvas.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* Pointer capture is best-effort. */
      }
    }
  };
  const onPointerMove = (event) => {
    if (dragging) {
      const view = ensureView();
      if (view) {
        const [x, y] = positionOf(event);
        view.cx -= (x - dragging[0]) / view.scale;
        view.cy -= (y - dragging[1]) / view.scale;
        dragging = [x, y];
        state.touched = true;
        redraw();
      }
    }
    onHover(event);
  };
  const onPointerUp = () => {
    dragging = null;
  };

  canvas.addEventListener("click", onClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onLeave);

  const onResize = () => {
    // The module runs before the external kit stylesheet lays the container
    // out: a view fitted at a degenerate size is recomputed once the real
    // box arrives, unless the user already drove the view.
    const { cssWidth, cssHeight } = metrics();
    if (!state.touched && state.fitSize !== null &&
      (state.fitSize.w <= 2 || state.fitSize.h <= 2) &&
      cssWidth > 2 && cssHeight > 2) {
      fitToBounds();
      return;
    }
    redraw();
  };

  let observer = null;
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(onResize);
    observer.observe(container);
  }

  function fitToBounds() {
    const setup = projectSetup();
    if (!setup) {
      state.view = null;
      state.fitScale = null;
      redraw();
      return null;
    }
    const { cssWidth, cssHeight } = metrics();
    const spanX = Math.max(1e-9, (setup.maxLon - setup.minLon) * setup.kx);
    const spanY = Math.max(1e-9, setup.maxLat - setup.minLat);
    const padding = 0.9;
    const scale = Math.min(cssWidth / spanX, cssHeight / spanY) * padding;
    state.fitScale = clampScale(scale);
    state.fitSize = { w: cssWidth, h: cssHeight };
    state.touched = false;
    state.view = {
      cx: spanX / 2,
      cy: spanY / 2,
      scale: clampScale(scale),
    };
    redraw();
    return { ...state.view };
  }

  const handle = {
    setZones(featureCollection) {
      state.sources.zones = featuresOf(featureCollection);
      state.selection = null;
      state.hover = null;
      state.view = null;
      redraw();
      return state.sources.zones.length;
    },
    setLots(featureCollection) {
      state.sources.lots = featuresOf(featureCollection);
      state.selection = null;
      state.hover = null;
      state.view = null;
      redraw();
      return state.sources.lots.length;
    },
    setOutlines(featureCollection) {
      state.sources.outlines = featureCollection === null || featureCollection === undefined
        ? []
        : featuresOf(featureCollection);
      state.view = null;
      redraw();
      return state.sources.outlines.length;
    },
    setPaint(paint) {
      const next = paint !== null && typeof paint === "object" ? paint : {};
      for (const layer of LAYER_ORDER) {
        if (next[layer] !== undefined) state.paint[layer] = next[layer];
      }
      redraw();
    },
    setBackground(color) {
      if (typeof color === "string" && color.length > 0) {
        state.background = color;
        redraw();
      }
    },
    setBasemapTemplate(template) {
      state.basemapTemplate = validateBasemapTemplate(template);
      state.tiles.clear();
      redraw();
    },
    setLabelsTemplate(template) {
      state.labelsTemplate = validateBasemapTemplate(template);
      state.tiles.clear();
      redraw();
    },
    setAttribution(value) {
      if (value === null || value === undefined) {
        state.attribution = [];
        return [];
      }
      const entries = Array.isArray(value) ? value : [value];
      for (const entry of entries) {
        if (typeof entry !== "string" || entry.length === 0) {
          throw new Error("map-base: attribution entries must be non-empty strings");
        }
      }
      state.attribution = [...entries];
      return [...state.attribution];
    },
    getAttribution() {
      return [...state.attribution];
    },
    on(kind, callback) {
      if ((kind !== "click" && kind !== "hover") || typeof callback !== "function") {
        throw new Error("map-base: on() expects 'click' or 'hover' with a function");
      }
      state.listeners[kind].add(callback);
      return () => state.listeners[kind].delete(callback);
    },
    fitToBounds,
    zoomIn() {
      zoomAt(1.5);
    },
    zoomOut() {
      zoomAt(1 / 1.5);
    },
    setView(view) {
      const current = ensureView();
      if (!current) return null;
      if (view !== null && typeof view === "object") {
        if (typeof view.scale === "number" && view.scale > 0) {
          current.scale = clampScale(view.scale);
        }
        if (typeof view.cx === "number") current.cx = view.cx;
        if (typeof view.cy === "number") current.cy = view.cy;
        state.touched = true;
      }
      redraw();
      return { ...current };
    },
    getView() {
      return state.view ? { ...state.view } : null;
    },
    getSelection() {
      return state.selection ? { ...state.selection } : null;
    },
    getFeatureCounts() {
      return {
        outlines: state.sources.outlines.length,
        zones: state.sources.zones.length,
        lots: state.sources.lots.length,
      };
    },
    destroy() {
      state.destroyed = true;
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onLeave);
      if (observer) observer.disconnect();
      state.tiles.clear();
      if (canvas.parentNode === container) container.removeChild(canvas);
    },
  };

  redraw();
  return handle;
}
