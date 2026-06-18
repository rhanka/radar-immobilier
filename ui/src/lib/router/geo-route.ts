export const GEO_REGION_KEY = "quebec";
export const DEFAULT_GEO_MODE = "signal";
export const FALLBACK_ZONE_PREFIX = "fallback:";

export type GeoMode = "signal" | "data";
export type GeoRegionKey = typeof GEO_REGION_KEY;
export type GeoRouteLevel = "region" | "city" | "zone";
export type GeoSelectionKind = "municipality" | "signal" | "zone" | "lot";

export interface GeoEntityRef {
  kind: GeoSelectionKind;
  id: string;
}

export interface GeoViewportState {
  lng: number;
  lat: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface GeoRouteState {
  mode: GeoMode;
  selected: GeoEntityRef[];
  focused: GeoEntityRef | null;
  filters: Record<string, string[]>;
  viewport: GeoViewportState | null;
  openPanelSections: string[];
}

export interface GeoRouteStateInput {
  mode?: GeoMode;
  selected?: readonly GeoEntityRef[];
  focused?: GeoEntityRef | null;
  filters?: Record<string, readonly string[]>;
  viewport?: GeoViewportState | null;
  openPanelSections?: readonly string[];
}

export type GeoRegionRoute = {
  level: "region";
  region: GeoRegionKey;
  state: GeoRouteState;
};

export type GeoCityRoute = {
  level: "city";
  citySlug: string;
  state: GeoRouteState;
};

export type GeoZoneRoute = {
  level: "zone";
  citySlug: string;
  zoneKey: string;
  state: GeoRouteState;
};

export type GeoRoute = GeoRegionRoute | GeoCityRoute | GeoZoneRoute;

export type GeoRouteTarget =
  | {
      level: "region";
      region?: GeoRegionKey;
      state?: GeoRouteStateInput;
    }
  | {
      level: "city";
      citySlug: string;
      state?: GeoRouteStateInput;
    }
  | {
      level: "zone";
      citySlug: string;
      zoneKey: string;
      state?: GeoRouteStateInput;
    };

export type GeoRouteParseIssue =
  | "invalid-url"
  | "not-geo-route"
  | "unsupported-geo-level"
  | "unsupported-region"
  | "missing-city-slug"
  | "missing-zone-key"
  | "extra-path-segments"
  | "invalid-path-encoding";

export type GeoRouteParseResult =
  | { ok: true; route: GeoRoute }
  | { ok: false; issue: GeoRouteParseIssue };

type UrlLike = URL | { pathname: string; search?: string };

const GEO_SELECTION_KINDS = new Set<string>([
  "municipality",
  "signal",
  "zone",
  "lot",
]);

function readUrlParts(input: string | UrlLike): UrlLike | null {
  if (typeof input !== "string") {
    return { pathname: input.pathname, search: input.search ?? "" };
  }

  try {
    const url = new URL(input, "https://radar.local");
    return { pathname: url.pathname, search: url.search };
  } catch {
    return null;
  }
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function assertNonEmptySegment(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty route segment`);
  }
}

function isGeoSelectionKind(value: string): value is GeoSelectionKind {
  return GEO_SELECTION_KINDS.has(value);
}

function compareEntityRef(left: GeoEntityRef, right: GeoEntityRef): number {
  return (
    left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)
  );
}

function serializeEntityRef(ref: GeoEntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

function parseEntityRef(value: string): GeoEntityRef | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) return null;

  const kind = value.slice(0, separatorIndex);
  const id = value.slice(separatorIndex + 1);
  if (!isGeoSelectionKind(kind) || id.length === 0) return null;

  return { kind, id };
}

function normalizeEntityRefs(
  refs: readonly GeoEntityRef[] | undefined,
): GeoEntityRef[] {
  const uniqueRefs = new Map<string, GeoEntityRef>();

  for (const ref of refs ?? []) {
    if (!isGeoSelectionKind(ref.kind) || ref.id.length === 0) continue;
    uniqueRefs.set(serializeEntityRef(ref), { kind: ref.kind, id: ref.id });
  }

  return [...uniqueRefs.values()].sort(compareEntityRef);
}

function normalizeFilters(
  filters: Record<string, readonly string[]> | undefined,
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};

  for (const [key, values] of Object.entries(filters ?? {})) {
    if (key.length === 0) continue;

    const normalizedValues = [...new Set(values.filter((value) => value !== ""))]
      .sort((left, right) => left.localeCompare(right));

    if (normalizedValues.length > 0) {
      normalized[key] = normalizedValues;
    }
  }

  return Object.fromEntries(
    Object.entries(normalized).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function normalizeOpenPanelSections(
  sections: readonly string[] | undefined,
): string[] {
  return [...new Set((sections ?? []).filter((section) => section !== ""))]
    .sort((left, right) => left.localeCompare(right));
}

function parseGeoMode(value: string | null): GeoMode {
  return value === "data" || value === "signal" ? value : DEFAULT_GEO_MODE;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseViewport(value: string | null): GeoViewportState | null {
  if (!value) return null;

  const parts = value.split(",");
  if (parts.length < 3 || parts.length > 5) return null;

  const numbers = parts.map((part) => Number(part));
  if (!numbers.every(Number.isFinite)) return null;

  const [lng, lat, zoom, bearing, pitch] = numbers;
  if (!isFiniteNumber(lng) || !isFiniteNumber(lat) || !isFiniteNumber(zoom)) {
    return null;
  }

  return {
    lng,
    lat,
    zoom,
    ...(isFiniteNumber(bearing) ? { bearing } : {}),
    ...(isFiniteNumber(pitch) ? { pitch } : {}),
  };
}

function serializeViewport(
  viewport: GeoViewportState | null | undefined,
): string | null {
  if (
    !viewport ||
    !Number.isFinite(viewport.lng) ||
    !Number.isFinite(viewport.lat) ||
    !Number.isFinite(viewport.zoom)
  ) {
    return null;
  }

  const values = [viewport.lng, viewport.lat, viewport.zoom];

  if (Number.isFinite(viewport.bearing) || Number.isFinite(viewport.pitch)) {
    values.push(viewport.bearing ?? 0);
  }

  if (viewport.pitch !== undefined && Number.isFinite(viewport.pitch)) {
    values.push(viewport.pitch);
  }

  return values.map(formatNumber).join(",");
}

export function buildFallbackZoneKey(citySlug: string): string {
  assertNonEmptySegment("citySlug", citySlug);
  return `${FALLBACK_ZONE_PREFIX}${citySlug}`;
}

export function isFallbackZoneKey(
  zoneKey: string,
  citySlug?: string,
): boolean {
  return citySlug
    ? zoneKey === buildFallbackZoneKey(citySlug)
    : zoneKey.startsWith(FALLBACK_ZONE_PREFIX);
}

export function isGeoRoutePathname(pathname: string): boolean {
  return pathname === "/geo" || pathname.startsWith("/geo/");
}

export function normalizeGeoRouteState(
  input: GeoRouteStateInput | undefined = {},
): GeoRouteState {
  const viewport = serializeViewport(input.viewport);

  return {
    mode: input.mode ?? DEFAULT_GEO_MODE,
    selected: normalizeEntityRefs(input.selected),
    focused: input.focused
      ? parseEntityRef(serializeEntityRef(input.focused))
      : null,
    filters: normalizeFilters(input.filters),
    viewport: viewport ? parseViewport(viewport) : null,
    openPanelSections: normalizeOpenPanelSections(input.openPanelSections),
  };
}

export function parseGeoQuery(search: string | URLSearchParams): GeoRouteState {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const selected = params
    .getAll("selected")
    .map(parseEntityRef)
    .filter((ref): ref is GeoEntityRef => ref !== null);

  const filters: Record<string, string[]> = {};
  for (const [key, value] of params.entries()) {
    if (!key.startsWith("filter.") || key === "filter.") continue;

    const filterKey = key.slice("filter.".length);
    filters[filterKey] = [...(filters[filterKey] ?? []), value];
  }

  return normalizeGeoRouteState({
    mode: parseGeoMode(params.get("mode")),
    selected,
    focused: parseEntityRef(params.get("focused") ?? ""),
    filters,
    viewport: parseViewport(params.get("viewport")),
    openPanelSections: params.getAll("panel"),
  });
}

export function buildGeoQuery(input: GeoRouteStateInput | undefined = {}): string {
  const state = normalizeGeoRouteState(input);
  const params = new URLSearchParams();

  params.set("mode", state.mode);

  for (const ref of state.selected) {
    params.append("selected", serializeEntityRef(ref));
  }

  if (state.focused) {
    params.set("focused", serializeEntityRef(state.focused));
  }

  for (const [key, values] of Object.entries(state.filters)) {
    for (const value of values) {
      params.append(`filter.${key}`, value);
    }
  }

  const viewport = serializeViewport(state.viewport);
  if (viewport) {
    params.set("viewport", viewport);
  }

  for (const section of state.openPanelSections) {
    params.append("panel", section);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function buildGeoPath(route: GeoRouteTarget): string {
  if (route.level === "region") {
    return `/geo/region/${route.region ?? GEO_REGION_KEY}`;
  }

  assertNonEmptySegment("citySlug", route.citySlug);

  if (route.level === "city") {
    return `/geo/city/${encodeSegment(route.citySlug)}`;
  }

  assertNonEmptySegment("zoneKey", route.zoneKey);
  return `/geo/zone/${encodeSegment(route.citySlug)}/${encodeSegment(route.zoneKey)}`;
}

export function buildGeoRoute(route: GeoRouteTarget): string {
  return `${buildGeoPath(route)}${buildGeoQuery(route.state)}`;
}

export function parseGeoRoute(input: string | UrlLike): GeoRouteParseResult {
  const parts = readUrlParts(input);
  if (!parts) return { ok: false, issue: "invalid-url" };

  const rawSegments = parts.pathname.split("/").filter(Boolean);
  const [root, level, firstSegment, secondSegment, ...extraSegments] =
    rawSegments;

  if (root !== "geo") return { ok: false, issue: "not-geo-route" };
  if (extraSegments.length > 0) {
    return { ok: false, issue: "extra-path-segments" };
  }

  const state = parseGeoQuery(parts.search ?? "");

  if (level === "region") {
    if (!firstSegment) return { ok: false, issue: "unsupported-region" };
    if (secondSegment) return { ok: false, issue: "extra-path-segments" };

    const region = decodeSegment(firstSegment);
    if (region === null) return { ok: false, issue: "invalid-path-encoding" };
    if (region !== GEO_REGION_KEY) {
      return { ok: false, issue: "unsupported-region" };
    }

    return { ok: true, route: { level, region, state } };
  }

  if (level === "city") {
    if (!firstSegment) return { ok: false, issue: "missing-city-slug" };
    if (secondSegment) return { ok: false, issue: "extra-path-segments" };

    const citySlug = decodeSegment(firstSegment);
    if (citySlug === null) {
      return { ok: false, issue: "invalid-path-encoding" };
    }

    return { ok: true, route: { level, citySlug, state } };
  }

  if (level === "zone") {
    if (!firstSegment) return { ok: false, issue: "missing-city-slug" };
    if (!secondSegment) return { ok: false, issue: "missing-zone-key" };

    const citySlug = decodeSegment(firstSegment);
    const zoneKey = decodeSegment(secondSegment);
    if (citySlug === null || zoneKey === null) {
      return { ok: false, issue: "invalid-path-encoding" };
    }

    return { ok: true, route: { level, citySlug, zoneKey, state } };
  }

  return { ok: false, issue: "unsupported-geo-level" };
}
