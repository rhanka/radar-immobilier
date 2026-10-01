import { EVAL_CATEGORIES, USAGE_GROUPS, type EvalLotFilter } from "$lib/maps/eval-lot-filters.js";
import { ZONE_KIND_GROUPS, type ZoneKindFilter } from "$lib/maps/zone-kind-filter.js";
import { bAxesFromVivierKey, keyForVivierB, type BAxes } from "$lib/signals/vivier-view-mode.js";
import type { VivierBExclusions } from "$lib/signals/vivier-b-display-filter.js";
import { SIGNAL_TIME_RANGE_PRESETS, type SignalTimeRange } from "$lib/signals/signal-date-filter.js";

export interface GeoFilterState {
  axes: BAxes;
  exclusions: VivierBExclusions;
  timeRange: SignalTimeRange;
  lots: EvalLotFilter;
  zoneKinds: ZoneKindFilter;
  zoneMillesime: string | null;
  lotsEnabled?: boolean;
  cptaqEnabled?: boolean;
  citySearch?: string;
  zoneSearch?: string;
  lotSearch?: string;
}

export function unrestrictedTimeRange(): SignalTimeRange {
  return { mode: "relative", relative: "all", from: 0, to: 0 };
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

/** Omitted restrictions are unrestricted, independent of browser preferences. */
export function readGeoFilters(filters: Record<string, readonly string[]>): GeoFilterState {
  const value = (key: string) => filters[key]?.[0];
  const legacy = filters.subset?.flatMap((item) => item.split("|"));
  const axes = legacy
    ? bAxesFromVivierKey(legacy.includes("vivier-v2") ? legacy.join("|") : "vivier-v2")
    : { z: value("zonage") === "1", r: value("residentiel") === "1", p: value("precoce") === "1" };
  const from = civilDate(value("dateFrom"));
  const to = civilDate(value("dateTo"));
  const period = value("period");
  const relative = SIGNAL_TIME_RANGE_PRESETS.some(({ token }) => token === period && token !== "all");
  const timeRange: SignalTimeRange = from !== null && to !== null && from <= to
    ? { mode: relative ? "relative" : "absolute", ...(relative ? { relative: period } : {}), from, to }
    : unrestrictedTimeRange();
  const category = EVAL_CATEGORIES.find(({ id }) => id === value("lotCategory"))?.id ?? "all";
  const usages = new Set(USAGE_GROUPS.filter(({ id }) => filters.lotUsage?.includes(id)).map(({ id }) => id));
  const minimum = Number(value("lotMinArea") ?? 0);
  return {
    axes,
    exclusions: {
      piiaSansProjetResidentiel: value("excludePiia") === "1",
      derogationsMineures: value("excludeDerogations") === "1",
    },
    timeRange,
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
  if (!(range.mode === "relative" && range.relative === "all")) {
    filters.dateFrom = [dateText(range.from)];
    filters.dateTo = [dateText(range.to)];
    if (range.mode === "relative" && range.relative) filters.period = [range.relative];
  }
  if (state.lots.category !== "all") filters.lotCategory = [state.lots.category];
  if (state.lots.usages.size) filters.lotUsage = [...state.lots.usages];
  if (state.lots.superficieMin > 0) filters.lotMinArea = [String(state.lots.superficieMin)];
  if (state.zoneKinds.size) filters.zoneKind = [...state.zoneKinds];
  if (state.zoneMillesime) filters.zoneMillesime = [state.zoneMillesime];
  if (state.lotsEnabled === false) filters.lots = ["0"];
  flag("cptaq", state.cptaqEnabled === true);
  for (const key of ["citySearch", "zoneSearch", "lotSearch"] as const) {
    const query = state[key];
    if (query) filters[key] = [query];
  }
  return filters;
}

export function subsetFromGeoFilters(filters: Record<string, readonly string[]>): string {
  return keyForVivierB(readGeoFilters(filters).axes);
}
