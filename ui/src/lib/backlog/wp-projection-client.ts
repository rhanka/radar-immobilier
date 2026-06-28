// WP6 — WP projection client (browser).
//
// Thin wrapper over `GET /api/backlog/wp-projection` (the read-model for the
// 4-level kanban: swimlanes WP1-6 × status columns × scales now/week/month/
// project). The WP grouping is a projection (Track stays source of truth; its
// workspace-contained parenting blocks a physical 6-WP reparent — see
// docs/spec/reports/wp6-socle-status.md).

import { resolveBacklogUrl } from "./backlog-client.js";

export const WP_ORDER = ["WP1", "WP2", "WP3", "WP4", "WP5", "WP6"] as const;
export type WpCode = (typeof WP_ORDER)[number];

export type WpStatus =
  | "planned"
  | "in_progress"
  | "blocked"
  | "needs_review"
  | "done"
  | "dropped";

export const WP_STATUS_COLUMNS: readonly { status: WpStatus; label: string }[] =
  [
    { status: "planned", label: "Planifié" },
    { status: "in_progress", label: "En cours" },
    { status: "blocked", label: "Bloqué" },
    { status: "needs_review", label: "À revoir" },
    { status: "done", label: "Fait" },
    { status: "dropped", label: "Abandonné" },
  ];

export type WpScale = "now" | "week" | "month" | "project";

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
  /** 2nd kanban level: WPx.y sub-item rollups (present when sub-map available). */
  subLanes?: SubLaneRollup[];
}

/**
 * One flat projected item — feeds the per-scale tabs. `scales` lists the
 * time-window tabs (`now`/`week`/`month`) the item belongs to; the `project`
 * (Global) tab is implicit and holds every item (incl. done/dropped).
 */
export interface WpProjItem {
  id: string;
  wp: WpCode;
  subItem?: string;
  status: WpStatus;
  scales: WpScale[];
}

export interface WpScaleView {
  scale: WpScale;
  since?: string;
  byWp: Record<WpCode, { fait: string[]; ouvert: string[] }>;
}

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

/**
 * Roll up the flat `items` into the `WpRollup[]` shape for a given scale tab,
 * reusing `swimlanes` as the catalog (WP titles + the full WPx.y sub-lane set,
 * incl. empty lanes). `project` (Global) keeps the authoritative server
 * `swimlanes` untouched (incl. blocked/AWAITED demotions the live fold can't
 * reproduce); the time-window tabs are recounted from the items in that window.
 */
export function rollupForScale(
  projection: WpProjection,
  scale: WpScale,
): WpRollup[] {
  if (scale === "project") return projection.swimlanes;
  const members = (projection.items ?? []).filter((i) =>
    i.scales.includes(scale),
  );
  const zero = () => ({
    total: 0,
    done: 0,
    needs_review: 0,
    in_progress: 0,
    planned: 0,
    blocked: 0,
    dropped: 0,
  });
  const pct = (c: ReturnType<typeof zero>): number | null => {
    const denom = c.total - c.dropped;
    return denom > 0 ? Math.round((100 * c.done) / denom) : null;
  };
  return projection.swimlanes.map((src) => {
    const wpItems = members.filter((i) => i.wp === src.wp);
    const c = zero();
    for (const it of wpItems) {
      c.total += 1;
      c[it.status] += 1;
    }
    const subLanes: SubLaneRollup[] = (src.subLanes ?? []).map((sl) => {
      const subItems = wpItems.filter((i) => i.subItem === sl.subItem);
      const sc = zero();
      for (const it of subItems) {
        sc.total += 1;
        sc[it.status] += 1;
      }
      return {
        subItem: sl.subItem,
        subItemId: sl.subItemId,
        title: sl.title,
        ...sc,
        pctDone: pct(sc),
      };
    });
    return {
      wp: src.wp,
      title: src.title,
      ...c,
      pctDone: pct(c),
      subLanes,
    };
  });
}

/** Fetch the WP projection read-model. Throws on HTTP error. */
export async function fetchWpProjection(
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<WpProjection> {
  const res = await fetch(resolveBacklogUrl("/api/backlog/wp-projection", baseUrl));
  if (!res.ok) throw new Error(`wp-projection HTTP ${res.status}`);
  return (await res.json()) as WpProjection;
}
