import { EVAL_CATEGORIES, USAGE_GROUPS, type EvalLotFilter } from "$lib/maps/eval-lot-filters.js";
import { ZONE_KIND_GROUPS, type ZoneKindFilter } from "$lib/maps/zone-kind-filter.js";
import { bAxesFromVivierKey, DEFAULT_B_AXES, keyForVivierB, type BAxes } from "$lib/signals/vivier-view-mode.js";
import { DEFAULT_VIVIER_B_EXCLUSIONS, type DocumentDateBasis, type VivierBExclusions } from "@radar/domain";
import {
  defaultSignalTimeRange,
  normalizeSignalTimeRange,
  SIGNAL_TIME_RANGE_PRESETS,
  type SignalTimeRange,
} from "$lib/signals/signal-date-filter.js";

/**
 * Shareable geographic filter snapshot (`filter.<key>` query parameters).
 *
 * Grammar:
 * - no `filter.*` key at all: product defaults (entry links, old bookmarks);
 * - at least one `filter.*` key: authoritative snapshot, every omitted
 *   restriction is unchecked/unrestricted (a dates-only link clears the rest);
 * - period: `period=<3mo|6mo|12mo|all>` (relative, resolved when opened) XOR
 *   `dateFrom`+`dateTo` (inclusive civil dates). A fully unrestricted snapshot
 *   is written as `period=all` so it stays distinct from the defaults.
 * - legacy `subset=vivier-v2[|-z|-r|-p|p]` (retired multi-vivier syntax) is
 *   normalized to the sole residual vivier, with product defaults elsewhere;
 * - legacy top-level `lots=0` / `layers=zones` without any `filter.*` key
 *   (parsed as `legacyLayers`) keeps the product defaults, zones only;
 * - date basis: `dateBasis=acquisition` (acquisition clock, internal value
 *   `scrap`); the legacy `dateBasis=scrap` spelling is still read so links
 *   shared before the rename keep working. Document dates are the default and
 *   are never written.
 */
export interface GeoFilterState {
  axes: BAxes;
  exclusions: VivierBExclusions;
  timeRange: SignalTimeRange;
  dateBasis: DocumentDateBasis;
  lots: EvalLotFilter;
  zoneKinds: ZoneKindFilter;
  zoneMillesime: string | null;
  lotsEnabled?: boolean;
  cptaqEnabled?: boolean;
  citySearch?: string;
  zoneSearch?: string;
  lotSearch?: string;
}

const RELATIVE_PERIODS = new Set(SIGNAL_TIME_RANGE_PRESETS.map(({ token }) => token));

export function unrestrictedTimeRange(): SignalTimeRange {
  return { mode: "relative", relative: "all", from: 0, to: 0 };
}

/** Every control unchecked and no period bound. */
export function unrestrictedGeoFilters(): GeoFilterState {
  return {
    axes: { z: false, r: false, p: false },
    exclusions: { piiaSansProjetResidentiel: false, derogationsMineures: false },
    timeRange: unrestrictedTimeRange(),
    dateBasis: "document",
    lots: { category: "all", usages: new Set(), superficieMin: 0 },
    zoneKinds: new Set(),
    zoneMillesime: null,
    lotsEnabled: true,
    cptaqEnabled: false,
    citySearch: "",
    zoneSearch: "",
    lotSearch: "",
  };
}

/** State shown when a geographic link carries no filter at all. */
export function defaultGeoFilters(now = Date.now()): GeoFilterState {
  return {
    ...unrestrictedGeoFilters(),
    axes: { ...DEFAULT_B_AXES },
    exclusions: { ...DEFAULT_VIVIER_B_EXCLUSIONS },
    timeRange: defaultSignalTimeRange(now),
  };
}

function civilDate(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.getTime() : null;
}

function dateText(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readTimeRange(value: (key: string) => string | undefined, now: number): SignalTimeRange {
  const period = value("period");
  if (period && RELATIVE_PERIODS.has(period)) {
    if (period === "all") return unrestrictedTimeRange();
    return normalizeSignalTimeRange({ mode: "relative", relative: period, from: 0, to: now }, now);
  }
  const from = civilDate(value("dateFrom"));
  const to = civilDate(value("dateTo"));
  return from !== null && to !== null && from <= to
    ? { mode: "absolute", from, to }
    : unrestrictedTimeRange();
}

/** URL spelling of the acquisition clock; the domain value stays `scrap` (API contract). */
const ACQUISITION_DATE_BASIS_PARAM = "acquisition";
const ACQUISITION_DATE_BASIS_URL_VALUES = new Set([ACQUISITION_DATE_BASIS_PARAM, "scrap"]);

/** `dateBasis=acquisition` (or legacy `scrap`) selects the acquisition clock; absent or invalid means document dates. */
function readDateBasis(value: (key: string) => string | undefined): DocumentDateBasis {
  return ACQUISITION_DATE_BASIS_URL_VALUES.has(value("dateBasis") ?? "") ? "scrap" : "document";
}

/** Omitted restrictions are unrestricted, independent of browser preferences. */
export function readGeoFilters(filters: Record<string, readonly string[]>, now = Date.now()): GeoFilterState {
  const value = (key: string) => filters[key]?.[0];
  const legacy = filters.subset?.flatMap((item) => item.split("|"));
  if (legacy || filters.legacyLayers || Object.keys(filters).length === 0) {
    const defaults = defaultGeoFilters(now);
    if (legacy) defaults.axes = bAxesFromVivierKey(legacy.includes("vivier-v2") ? legacy.join("|") : "vivier-v2");
    if (value("lots") === "0") defaults.lotsEnabled = false;
    defaults.dateBasis = readDateBasis(value);
    return defaults;
  }
  const category = EVAL_CATEGORIES.find(({ id }) => id === value("lotCategory"))?.id ?? "all";
  const usages = new Set(USAGE_GROUPS.filter(({ id }) => filters.lotUsage?.includes(id)).map(({ id }) => id));
  const minimum = Number(value("lotMinArea") ?? 0);
  return {
    axes: { z: value("zonage") === "1", r: value("residentiel") === "1", p: value("precoce") === "1" },
    exclusions: {
      piiaSansProjetResidentiel: value("excludePiia") === "1",
      derogationsMineures: value("excludeDerogations") === "1",
    },
    timeRange: readTimeRange(value, now),
    dateBasis: readDateBasis(value),
    lots: { category, usages, superficieMin: Number.isFinite(minimum) && minimum > 0 ? minimum : 0 },
    zoneKinds: new Set(ZONE_KIND_GROUPS.filter(({ id }) => filters.zoneKind?.includes(id)).map(({ id }) => id)),
    zoneMillesime: value("zoneMillesime") ?? null,
    lotsEnabled: value("lots") !== "0",
    cptaqEnabled: value("cptaq") === "1",
    citySearch: value("citySearch") ?? "",
    zoneSearch: value("zoneSearch") ?? "",
    lotSearch: value("lotSearch") ?? "",
  };
}

/** Lot restrictions shared by the Signals and Evaluation views. */
export function writeLotFilters(lots: EvalLotFilter): Record<string, string[]> {
  const filters: Record<string, string[]> = {};
  if (lots.category !== "all") filters.lotCategory = [lots.category];
  if (lots.usages.size) filters.lotUsage = [...lots.usages];
  if (lots.superficieMin > 0) filters.lotMinArea = [String(lots.superficieMin)];
  return filters;
}

/** Named restrictions describe the sole residual vivier, never a selectable mode. */
export function writeGeoFilters(state: GeoFilterState): Record<string, string[]> {
  const filters: Record<string, string[]> = {};
  const flag = (key: string, enabled: boolean) => { if (enabled) filters[key] = ["1"]; };
  flag("zonage", state.axes.z);
  flag("residentiel", state.axes.r);
  flag("precoce", state.axes.p);
  flag("excludePiia", state.exclusions.piiaSansProjetResidentiel);
  flag("excludeDerogations", state.exclusions.derogationsMineures);
  const range = state.timeRange;
  if (state.dateBasis === "scrap") filters.dateBasis = [ACQUISITION_DATE_BASIS_PARAM];
  if (range.mode === "relative" && range.relative && RELATIVE_PERIODS.has(range.relative)) {
    if (range.relative !== "all") filters.period = [range.relative];
  } else {
    filters.dateFrom = [dateText(range.from)];
    filters.dateTo = [dateText(range.to)];
  }
  Object.assign(filters, writeLotFilters(state.lots));
  if (state.zoneKinds.size) filters.zoneKind = [...state.zoneKinds];
  if (state.zoneMillesime) filters.zoneMillesime = [state.zoneMillesime];
  if (state.lotsEnabled === false) filters.lots = ["0"];
  flag("cptaq", state.cptaqEnabled === true);
  for (const key of ["citySearch", "zoneSearch", "lotSearch"] as const) {
    const query = state[key];
    if (query) filters[key] = [query];
  }
  // Keep "everything unchecked, no period" distinct from the product defaults.
  if (Object.keys(filters).length === 0) filters.period = ["all"];
  return filters;
}

/** Same shared period: same relative preset, or same civil-date bounds. */
export function sameTimeRange(a: SignalTimeRange, b: SignalTimeRange): boolean {
  const relative = (range: SignalTimeRange) =>
    range.mode === "relative" && range.relative && RELATIVE_PERIODS.has(range.relative) ? range.relative : null;
  const [ra, rb] = [relative(a), relative(b)];
  if (ra || rb) return ra === rb;
  return dateText(a.from) === dateText(b.from) && dateText(a.to) === dateText(b.to);
}

export function subsetFromGeoFilters(filters: Record<string, readonly string[]>): string {
  return keyForVivierB(readGeoFilters(filters).axes);
}
