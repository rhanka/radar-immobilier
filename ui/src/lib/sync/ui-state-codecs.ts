import { isRecord, isUuidLike, onlyKeys } from "../sw/protocol.js";
import { isKnownRouteView } from "../router/router.js";
import { buildGeoRoute, normalizeGeoRouteState, parseGeoRoute,
  type GeoRouteState } from "../router/geo-route.js";
import { readGeoFilters, writeGeoFilters } from "../router/geo-filter-state.js";
import { CONTEXT_SCHEMA, SESSION_SCHEMA, SCHEMA_VERSION, CONTEXT_TTL, MAX_CONTEXT_BYTES,
  type UiContext, type UiSession, type ContextPayload, type ContextTarget } from "./ui-state-contract.js";

export const PERSISTABLE_FILTERS = new Set(["zonage", "residentiel", "precoce", "excludePiia",
  "excludeDerogations", "period", "dateFrom", "dateTo", "dateBasis", "lotCategory", "lotUsage",
  "lotMinArea", "zoneKind", "zoneMillesime", "lots", "cptaq"]);
const bounded = (v: unknown, max = 256): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const partition = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const parse = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return null; } };

export function decodeSession(raw: string): UiSession | null {
  const v = parse(raw);
  return isRecord(v) && onlyKeys(v, ["schema", "schemaVersion", "partition", "sessionEpoch", "invalidated"])
    && v.schema === SESSION_SCHEMA && v.schemaVersion === SCHEMA_VERSION && partition(v.partition)
    && isUuidLike(v.sessionEpoch) && typeof v.invalidated === "boolean" ? v as unknown as UiSession : null;
}

export function validTarget(v: unknown): v is ContextTarget {
  if (!isRecord(v)) return false;
  if (v.kind === "page") return onlyKeys(v, ["kind", "view"]) && isKnownRouteView(v.view);
  if (v.kind !== "geo" || !onlyKeys(v, ["kind", "route"]) || !isRecord(v.route)) return false;
  const r = v.route;
  if (r.level === "region") return onlyKeys(r, ["level", "region"]) && r.region === "quebec";
  if (r.level === "city") return onlyKeys(r, ["level", "citySlug"]) && bounded(r.citySlug);
  return r.level === "zone" && onlyKeys(r, ["level", "citySlug", "zoneKey"])
    && bounded(r.citySlug) && bounded(r.zoneKey);
}

export function projectContext(target: ContextTarget, state: GeoRouteState): ContextPayload {
  const original = state.filters;
  // Preserve the no-filter product-default grammar; a stripped authoritative
  // snapshot instead needs an explicit unrestricted marker (period=all).
  const filters = Object.keys(original).length ? writeGeoFilters(readGeoFilters(original)) : {};
  const projected = Object.fromEntries(Object.entries(filters).filter(([key]) => PERSISTABLE_FILTERS.has(key)));
  if (Object.keys(original).some((key) => key !== "showDiscarded") && !Object.keys(projected).length) projected.period = ["all"];
  return { target, state: normalizeGeoRouteState({ ...state, filters: projected }),
    partial: Object.entries(original).some(([key, values]) => !PERSISTABLE_FILTERS.has(key)
      && values.some((v) => v !== "" && v !== "0")) };
}

function validState(v: unknown): v is GeoRouteState {
  if (!isRecord(v) || !onlyKeys(v, ["mode", "selected", "focused", "filters", "viewport", "openPanelSections"])
    || !["signal", "data"].includes(String(v.mode)) || !Array.isArray(v.selected) || v.selected.length > 128
    || !isRecord(v.filters) || !Array.isArray(v.openPanelSections) || v.openPanelSections.length > 32) return false;
  const entity = (ref: unknown) => isRecord(ref) && onlyKeys(ref, ["kind", "id"])
    && ["municipality", "signal", "zone", "lot"].includes(String(ref.kind)) && bounded(ref.id, 512);
  if (!v.selected.every(entity) || (v.focused !== null && !entity(v.focused))
    || !v.openPanelSections.every((s) => bounded(s, 64))) return false;
  if (!Object.entries(v.filters).every(([key, values]) => PERSISTABLE_FILTERS.has(key)
    && Array.isArray(values) && values.length <= 32 && values.every((s) => bounded(s)))) return false;
  if (v.viewport !== null) {
    const p = v.viewport;
    if (!isRecord(p) || !onlyKeys(p, ["lng", "lat", "zoom", "bearing", "pitch"])
      || ![p.lng, p.lat, p.zoom].every((n) => typeof n === "number" && Number.isFinite(n))
      || Object.values(p).some((n) => typeof n !== "number" || !Number.isFinite(n))
      || Math.abs(Number(p.lng)) > 180 || Math.abs(Number(p.lat)) > 90
      || Number(p.zoom) < 0 || Number(p.zoom) > 24) return false;
  }
  return true;
}

/** No destructive migration in J0: only the embedded approved schema is read.
 * Unsupported versions stay byte-for-byte in storage, including on rollback. */
export function decodeContext(raw: string, now: number, allowExpired = false): UiContext | null {
  if (new TextEncoder().encode(raw).length > MAX_CONTEXT_BYTES) return null;
  const v = parse(raw);
  if (!isRecord(v) || !onlyKeys(v, ["schema", "schemaVersion", "partition", "sessionEpoch", "workspaceId",
    "tabId", "revision", "savedAt", "expiresAt", "payload"]) || v.schema !== CONTEXT_SCHEMA
    || v.schemaVersion !== SCHEMA_VERSION || !partition(v.partition) || !isUuidLike(v.sessionEpoch)
    || !isUuidLike(v.workspaceId) || !isUuidLike(v.tabId) || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1
    || typeof v.savedAt !== "number" || !Number.isFinite(v.savedAt) || v.savedAt < 0 || v.savedAt > now
    || typeof v.expiresAt !== "number" || !Number.isFinite(v.expiresAt)
    || (!allowExpired && v.expiresAt <= now) || v.expiresAt <= v.savedAt
    || v.expiresAt - v.savedAt > CONTEXT_TTL || !isRecord(v.payload)
    || !onlyKeys(v.payload, ["target", "state", "partial"]) || typeof v.payload.partial !== "boolean"
    || !validTarget(v.payload.target) || !validState(v.payload.state)) return null;
  return v as unknown as UiContext;
}

/** Use the existing geographic codec as the sole route spelling. */
export function geographicTarget(route: { level: string; [key: string]: unknown }): ContextTarget | null {
  const { state: _state, ...target } = route;
  const candidate = { kind: "geo", route: target };
  if (!validTarget(candidate)) return null;
  const parsed = parseGeoRoute(buildGeoRoute(candidate.route));
  return parsed.ok ? candidate : null;
}
