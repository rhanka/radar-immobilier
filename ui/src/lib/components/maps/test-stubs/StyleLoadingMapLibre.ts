import { vi } from "vitest";

type Source = { data: unknown; setData: (data: unknown) => void };
type Handler = (event?: unknown) => void;
export const styleLoadingMaps: StyleLoadingMap[] = [];

/** Boundary double: source/layer mutations require a parsed, live style. */
export class StyleLoadingMap {
  styleReady = false;
  removed = false;
  sources = new Map<string, Source>();
  layers = new Map<string, Record<string, unknown>>();
  handlers = new Map<string, Handler[]>();
  constructor(_options: unknown) { styleLoadingMaps.push(this); }

  private checkStyle(): void {
    if (this.removed || !this.styleReady) throw new Error("Style is not done loading.");
  }
  isStyleLoaded = vi.fn(() => this.styleReady);
  addSource = vi.fn((id: string, spec: { data: unknown }) => {
    this.checkStyle();
    if (this.sources.has(id)) throw new Error(`Duplicate source: ${id}`);
    const source: Source = {
      data: spec.data,
      setData: vi.fn((data: unknown) => { source.data = data; }),
    };
    this.sources.set(id, source);
  });
  addLayer = vi.fn((spec: Record<string, unknown> & { id: string }) => {
    this.checkStyle();
    if (this.layers.has(spec.id)) throw new Error(`Duplicate layer: ${spec.id}`);
    this.layers.set(spec.id, spec);
  });
  getSource = vi.fn((id: string) => this.sources.get(id));
  getLayer = vi.fn((id: string) => this.layers.get(id));
  setPaintProperty = vi.fn();
  setLayoutProperty = vi.fn();
  moveLayer = vi.fn();
  setFeatureState = vi.fn();
  removeLayer = vi.fn((id: string) => this.layers.delete(id));
  removeSource = vi.fn((id: string) => this.sources.delete(id));
  remove = vi.fn(() => { this.removed = true; });
  getCanvas = vi.fn(() => ({ style: {} }));
  getContainer = vi.fn(() => document.createElement("div"));
  getCenter = vi.fn(() => ({ lng: -73.5, lat: 45.7 }));
  getZoom = vi.fn(() => 7);
  flyTo = vi.fn();
  easeTo = vi.fn();
  fitBounds = vi.fn();
  on(type: string, handlerOrLayer: Handler | string, layerHandler?: Handler): void {
    const key = typeof handlerOrLayer === "string" ? `${type}:${handlerOrLayer}` : type;
    const handler = typeof handlerOrLayer === "string" ? layerHandler! : handlerOrLayer;
    this.handlers.set(key, [...(this.handlers.get(key) ?? []), handler]);
  }
  fire(type: string, event?: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
  finishStyle(): void {
    this.styleReady = true;
    this.fire("style.load");
  }
}
