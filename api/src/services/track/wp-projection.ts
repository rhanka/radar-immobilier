/**
 * WP6 — WorkPackage projection (read-model for the 4-level kanban).
 *
 * The kanban view needs a per-WorkPackage rollup across 4 time scales
 * (now / week / month / project). Track is the source of truth; the WP grouping
 * is a PROJECTION (`docs/spec/reports/wp6-item-wp-map.json`) because Track 0.19.2
 * enforces workspace-contained parenting (an item cannot be reparented across
 * workspaces), so the 6 WP roots cannot physically adopt the 111 legacy items.
 *
 * Two sources, same normalized DTO:
 *  - **precomputed** (preferred): `docs/spec/reports/wp6-rollup.json`, produced by
 *    `wp6-projection.py` from Track's authoritative buckets + transition timestamps
 *    (all 4 scales). The route reads it fresh each request (regen updates it).
 *  - **live fallback**: when the precomputed file is absent, fold the sidecar +
 *    apply the WP map → project-scale rollup only (now = in-progress WIP). Status
 *    is approximated from realization+acceptance (needs_review = done & unsigned).
 *
 * Pure where possible: `projectLive(items, map)` has no I/O; the loaders touch the FS.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadTrackItems, type TrackItem } from "./track-reader.js";

export const WP_ORDER = ["WP1", "WP2", "WP3", "WP4", "WP5", "WP6"] as const;
export type WpCode = (typeof WP_ORDER)[number];

export const WP_TITLE: Record<WpCode, string> = {
  WP1: "DATA — sources & substrat",
  WP2: "EXTRACTION — signaux & ontologie",
  WP3: "RÉCONCILIATION E2E & PREUVE",
  WP4: "PRODUIT — app radar client",
  WP5: "PLATEFORME & SCALE",
  WP6: "GOUVERNANCE — pilotage Track",
};

/** Client-facing status (decision §3); AWAITED done unsigned => needs_review. */
export type WpStatus =
  | "done"
  | "needs_review"
  | "in_progress"
  | "planned"
  | "blocked"
  | "dropped";

export const WP_STATUS_COLUMNS: readonly WpStatus[] = [
  "planned",
  "in_progress",
  "blocked",
  "needs_review",
  "done",
  "dropped",
];

/** One sub-item (WPx.y) rollup — the 2nd kanban level inside a WP swimlane. */
export interface SubLaneRollup {
  subItem: string;
  subItemId: string;
  title: string;
  total: number;
  done: number;
  needs_review: number;
  in_progress: number;
  planned: number;
  blocked: number;
  dropped: number;
  pctDone: number | null;
}

/** One WP swimlane rollup. `subLanes` is the 2nd-level WPx.y grouping (optional). */
export interface WpRollup {
  wp: WpCode;
  title: string;
  total: number;
  done: number;
  needs_review: number;
  in_progress: number;
  planned: number;
  blocked: number;
  dropped: number;
  pctDone: number | null;
  /** WPx.y sub-item rollups (present when the sub-item map is available). */
  subLanes?: SubLaneRollup[];
}

/** The four kanban time scales (primary tabs). `project` = global (all, incl. done). */
export type WpScale = "now" | "week" | "month" | "project";

/** A time scale view: which items are "fait"/"ouvert" per WP (now = wip only). */
export interface WpScaleView {
  scale: WpScale;
  since?: string;
  byWp: Record<WpCode, { fait: string[]; ouvert: string[] }>;
}

/**
 * One flat projected item — feeds the per-scale tabs (status × WP × sub-lane).
 *
 * Scale rule (the kanban's 4 levels): `scales` lists the *time-window* tabs an
 * item belongs to among `now`/`week`/`month`; the `project` (Global) tab is
 * implicit and always holds every item (incl. done/dropped — the past is kept).
 *   - `now`   ⇐ item is in-progress WIP.
 *   - `week`  ⇐ item closed/transitioned in the last 7 days (precomputed window).
 *   - `month` ⇐ item active in the current month (precomputed window).
 * `status` is the live-derived bucket (coarse: `blocked`/AWAITED demotions live
 * only in the authoritative `swimlanes`, which the Global tab renders).
 */
export interface WpProjItem {
  id: string;
  wp: WpCode;
  subItem?: string;
  status: WpStatus;
  scales: WpScale[];
}

/** Normalized projection DTO consumed by the kanban. */
export interface WpProjection {
  available: boolean;
  source: "precomputed" | "live" | "unavailable";
  generatedAt: string;
  swimlanes: WpRollup[];
  scales: Partial<Record<WpScale, WpScaleView>>;
  /** Flat per-item projection (status + WP + sub-item + scale membership). */
  items: WpProjItem[];
  titles: Record<string, string>;
  note?: string;
}

interface WpMapEntry {
  itemId: string;
  wpCode: WpCode;
}
interface WpMapFile {
  items: WpMapEntry[];
}

/** A WPx.y catalog entry (the 29 sub-items, incl. empty ones). */
export interface SubLaneCatalogEntry {
  code: string;
  wp: WpCode;
  subItemId: string;
  title: string;
}
/** itemId → WPx.y sub-item attachment (the 2nd-level projection map). */
export interface SubMapEntry {
  itemId: string;
  wp: WpCode;
  subItem: string;
  subItemId: string;
  title: string;
}
interface SubMapFile {
  subItems: Record<string, { id: string; title: string; workspace?: string }>;
  items: SubMapEntry[];
}

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..", "..");
const DEFAULT_MAP_PATH = join(
  REPO_ROOT,
  "docs",
  "spec",
  "reports",
  "wp6-item-wp-map.json",
);
const DEFAULT_ROLLUP_PATH = join(
  REPO_ROOT,
  "docs",
  "spec",
  "reports",
  "wp6-rollup.json",
);
const DEFAULT_SUBMAP_PATH = join(
  REPO_ROOT,
  "docs",
  "spec",
  "reports",
  "wp6-item-subitem-map.json",
);

function emptyByWp(): Record<WpCode, { fait: string[]; ouvert: string[] }> {
  const out = {} as Record<WpCode, { fait: string[]; ouvert: string[] }>;
  for (const wp of WP_ORDER) out[wp] = { fait: [], ouvert: [] };
  return out;
}

/**
 * Status of a folded item — live approximation of Track's bucket (the reader
 * drops the acceptance-criteria/blocker facts that drive AWAITED, so this is a
 * coarse view; the precomputed read-model carries the authoritative AWAITED ⇒
 * needs_review figure). Rule: realization `done` ⇒ DONE bucket (matches the
 * reader), demoted to `needs_review` only on an explicit failing acceptance run.
 */
export function liveStatus(item: TrackItem): WpStatus {
  if (item.realization === "cancelled" || item.realization === "rejected")
    return "dropped";
  if (item.realization === "done")
    return item.acceptance === "fail" ? "needs_review" : "done";
  if (item.realization === "in-progress") return "in_progress";
  return "planned";
}

/**
 * Pure: flatten items into the per-scale projection list (status × WP × sub-lane).
 *
 * Membership of the time-window tabs (`now`/`week`/`month`) is read from the
 * scale views (which carry the authoritative windows: live `now` = WIP, the
 * precomputed read-model adds `week`/`month`); `project` (Global) is implicit so
 * every mapped item is emitted. `sub` (when present) annotates the WPx.y lane.
 */
export function buildProjItems(
  items: TrackItem[],
  map: WpMapEntry[],
  sub: SubMapEntry[] | null,
  scales: Partial<Record<WpScale, WpScaleView>>,
): WpProjItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const item2sub = new Map((sub ?? []).map((e) => [e.itemId, e.subItem]));
  const windows: WpScale[] = ["now", "week", "month"];
  const inWindow = (scale: WpScale, id: string): boolean => {
    const v = scales[scale];
    if (!v) return false;
    for (const wp of WP_ORDER) {
      const e = v.byWp[wp];
      if (e && (e.fait.includes(id) || e.ouvert.includes(id))) return true;
    }
    return false;
  };
  const out: WpProjItem[] = [];
  for (const m of map) {
    const it = byId.get(m.itemId);
    if (!it) continue;
    const subItem = item2sub.get(m.itemId);
    out.push({
      id: m.itemId,
      wp: m.wpCode,
      status: liveStatus(it),
      ...(subItem ? { subItem } : {}),
      scales: windows.filter((s) => inWindow(s, m.itemId)),
    });
  }
  return out;
}

/** Pure: project folded items onto the WP map (project scale + now). */
export function projectLive(
  items: TrackItem[],
  map: WpMapEntry[],
): WpProjection {
  const item2wp = new Map<string, WpCode>(
    map.map((m) => [m.itemId, m.wpCode]),
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  const titles: Record<string, string> = {};
  const lanes = new Map<WpCode, WpRollup>(
    WP_ORDER.map((wp) => [
      wp,
      {
        wp,
        title: WP_TITLE[wp],
        total: 0,
        done: 0,
        needs_review: 0,
        in_progress: 0,
        planned: 0,
        blocked: 0,
        dropped: 0,
        pctDone: null,
      },
    ]),
  );
  const projectView: WpScaleView = { scale: "project", byWp: emptyByWp() };
  const nowView: WpScaleView = { scale: "now", byWp: emptyByWp() };

  for (const [id, wp] of item2wp) {
    const it = byId.get(id);
    if (!it) continue;
    titles[id] = it.title;
    const st = liveStatus(it);
    const lane = lanes.get(wp)!;
    lane.total += 1;
    lane[st] += 1;
    if (st === "done" || st === "needs_review") projectView.byWp[wp].fait.push(id);
    if (st === "planned" || st === "in_progress") {
      projectView.byWp[wp].ouvert.push(id);
      if (st === "in_progress") nowView.byWp[wp].fait.push(id);
    }
  }
  for (const lane of lanes.values()) {
    const denom = lane.total - lane.dropped;
    lane.pctDone = denom > 0 ? Math.round((100 * lane.done) / denom) : null;
  }
  const scales = { project: projectView, now: nowView };
  return {
    available: true,
    source: "live",
    generatedAt: new Date().toISOString(),
    swimlanes: WP_ORDER.map((wp) => lanes.get(wp)!),
    scales,
    items: buildProjItems(items, map, null, scales),
    titles,
    note: "Live fold du sidecar + projection WP. needs_review = done non signé (approx. AWAITED). Scales week/month indisponibles en live (regénérer wp6-rollup.json pour les fenêtres temporelles).",
  };
}

/**
 * Pure: group items into WPx.y sub-lanes (the 2nd kanban level). `catalog` holds
 * the full 29 sub-items (so empty lanes still render); `entries` is the
 * itemId → WPx.y projection. Lanes keep catalog order (WP1.1, WP1.2, …).
 */
export function projectSubLanes(
  items: TrackItem[],
  entries: SubMapEntry[],
  catalog: SubLaneCatalogEntry[],
): Record<WpCode, SubLaneRollup[]> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const laneByCode = new Map<string, SubLaneRollup>();
  const out = {} as Record<WpCode, SubLaneRollup[]>;
  for (const wp of WP_ORDER) out[wp] = [];
  for (const c of catalog) {
    const lane: SubLaneRollup = {
      subItem: c.code,
      subItemId: c.subItemId,
      title: c.title,
      total: 0,
      done: 0,
      needs_review: 0,
      in_progress: 0,
      planned: 0,
      blocked: 0,
      dropped: 0,
      pctDone: null,
    };
    laneByCode.set(c.code, lane);
    out[c.wp].push(lane);
  }
  for (const e of entries) {
    const it = byId.get(e.itemId);
    const lane = laneByCode.get(e.subItem);
    if (!it || !lane) continue;
    lane.total += 1;
    lane[liveStatus(it)] += 1;
  }
  for (const lane of laneByCode.values()) {
    const denom = lane.total - lane.dropped;
    lane.pctDone = denom > 0 ? Math.round((100 * lane.done) / denom) : null;
  }
  return out;
}

/** Load the WPx.y sub-item map (catalog + entries). Returns null when absent. */
function loadSubMap(
  env: NodeJS.ProcessEnv,
): { catalog: SubLaneCatalogEntry[]; entries: SubMapEntry[] } | null {
  const path = env.WP_SUBMAP_PATH?.trim() || DEFAULT_SUBMAP_PATH;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SubMapFile;
    if (!parsed.subItems || !Array.isArray(parsed.items)) return null;
    const catalog: SubLaneCatalogEntry[] = Object.entries(parsed.subItems)
      .map(([code, v]) => ({
        code,
        wp: code.split(".")[0] as WpCode,
        subItemId: v.id,
        title: v.title,
      }))
      .filter((c) => WP_ORDER.includes(c.wp))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return { catalog, entries: parsed.items };
  } catch {
    return null;
  }
}

/**
 * Enrich a projection with the 2nd kanban level + the flat per-scale item list:
 *  - `swimlanes[].subLanes` — WPx.y sub-lane rollups (no-op when map/track absent).
 *  - `items` — flat `{wp, subItem, status, scales}` feeding the per-scale tabs
 *    (rebuilt here because the precomputed read-model carries no per-item status).
 */
function attachSubLanesAndItems(
  projection: WpProjection,
  env: NodeJS.ProcessEnv,
): WpProjection {
  const track = loadTrackItems(env);
  if (!track.available) return projection;
  const sub = loadSubMap(env);
  const map = loadWpMap(env);
  if (sub) {
    const lanes = projectSubLanes(track.items, sub.entries, sub.catalog);
    for (const lane of projection.swimlanes) lane.subLanes = lanes[lane.wp];
  }
  if (map) {
    projection.items = buildProjItems(
      track.items,
      map,
      sub?.entries ?? null,
      projection.scales,
    );
  }
  return projection;
}

function loadWpMap(env: NodeJS.ProcessEnv): WpMapEntry[] | null {
  const path = env.WP_MAP_PATH?.trim() || DEFAULT_MAP_PATH;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as WpMapFile;
    return Array.isArray(parsed.items) ? parsed.items : null;
  } catch {
    return null;
  }
}

/** Shape of the precomputed wp6-rollup.json (subset we read). */
interface PrecomputedRollup {
  generatedAt: string;
  project_rollup: Record<
    string,
    {
      total: number;
      done: number;
      needs_review: number;
      in_progress: number;
      planned: number;
      blocked: number;
      dropped: number;
      pct_done: number | null;
    }
  >;
  views: Record<
    string,
    {
      since?: string;
      by_wp: Record<
        string,
        { fait?: string[]; ouvert?: string[] } | string[]
      >;
    }
  >;
  titles: Record<string, string>;
}

function loadPrecomputed(env: NodeJS.ProcessEnv): WpProjection | null {
  const path = env.WP_ROLLUP_PATH?.trim() || DEFAULT_ROLLUP_PATH;
  let raw: PrecomputedRollup;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as PrecomputedRollup;
  } catch {
    return null;
  }
  const swimlanes: WpRollup[] = WP_ORDER.map((wp) => {
    const p = raw.project_rollup[wp];
    return {
      wp,
      title: WP_TITLE[wp],
      total: p?.total ?? 0,
      done: p?.done ?? 0,
      needs_review: p?.needs_review ?? 0,
      in_progress: p?.in_progress ?? 0,
      planned: p?.planned ?? 0,
      blocked: p?.blocked ?? 0,
      dropped: p?.dropped ?? 0,
      pctDone: p?.pct_done ?? null,
    };
  });
  const scales: Partial<Record<WpScaleView["scale"], WpScaleView>> = {};
  for (const scale of ["now", "week", "month", "project"] as const) {
    const v = raw.views[scale];
    if (!v) continue;
    const byWp = emptyByWp();
    for (const wp of WP_ORDER) {
      const entry = v.by_wp[wp];
      if (Array.isArray(entry)) byWp[wp] = { fait: entry, ouvert: [] };
      else if (entry)
        byWp[wp] = { fait: entry.fait ?? [], ouvert: entry.ouvert ?? [] };
    }
    scales[scale] = { scale, ...(v.since ? { since: v.since } : {}), byWp };
  }
  return {
    available: true,
    source: "precomputed",
    generatedAt: raw.generatedAt,
    swimlanes,
    scales,
    items: [], // populated by loadWpProjection (needs track + maps for per-item status)
    titles: raw.titles ?? {},
  };
}

/**
 * Load the WP projection: prefer the precomputed read-model (all 4 scales), else
 * fold the live sidecar + WP map (project scale only). Never throws.
 */
export function loadWpProjection(
  env: NodeJS.ProcessEnv = process.env,
): WpProjection {
  const pre = loadPrecomputed(env);
  if (pre) return attachSubLanesAndItems(pre, env);
  const map = loadWpMap(env);
  const track = loadTrackItems(env);
  if (!map || !track.available) {
    return {
      available: false,
      source: "unavailable",
      generatedAt: new Date().toISOString(),
      swimlanes: WP_ORDER.map((wp) => ({
        wp,
        title: WP_TITLE[wp],
        total: 0,
        done: 0,
        needs_review: 0,
        in_progress: 0,
        planned: 0,
        blocked: 0,
        dropped: 0,
        pctDone: null,
      })),
      scales: {},
      items: [],
      titles: {},
      note: "Ni read-model précalculé (wp6-rollup.json) ni sidecar+mapping disponibles.",
    };
  }
  return attachSubLanesAndItems(projectLive(track.items, map), env);
}
