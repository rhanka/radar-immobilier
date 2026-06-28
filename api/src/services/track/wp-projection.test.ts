import { describe, expect, it } from "vitest";

import {
  buildProjItems,
  liveStatus,
  projectLive,
  projectSubLanes,
  WP_ORDER,
} from "./wp-projection.js";
import type { TrackItem } from "./track-reader.js";

function item(over: Partial<TrackItem> & { id: string }): TrackItem {
  return {
    title: over.title ?? over.id,
    workspace: over.workspace ?? "ws",
    kind: over.kind ?? "feature",
    realization: over.realization ?? "to-do",
    acceptance: over.acceptance ?? "none",
    bucket: over.bucket ?? "TO-DO",
    ...over,
  } as TrackItem;
}

describe("liveStatus", () => {
  it("maps realization done -> done (DONE bucket parity, acceptance none)", () => {
    expect(liveStatus(item({ id: "a", realization: "done" }))).toBe("done");
  });
  it("demotes done + acceptance fail -> needs_review", () => {
    expect(
      liveStatus(item({ id: "a", realization: "done", acceptance: "fail" })),
    ).toBe("needs_review");
  });
  it("cancelled/rejected -> dropped", () => {
    expect(liveStatus(item({ id: "a", realization: "cancelled" }))).toBe("dropped");
    expect(liveStatus(item({ id: "b", realization: "rejected" }))).toBe("dropped");
  });
  it("in-progress -> in_progress, to-do -> planned", () => {
    expect(liveStatus(item({ id: "a", realization: "in-progress" }))).toBe(
      "in_progress",
    );
    expect(liveStatus(item({ id: "b", realization: "to-do" }))).toBe("planned");
  });
});

describe("projectLive", () => {
  const items: TrackItem[] = [
    item({ id: "i1", realization: "done" }),
    item({ id: "i2", realization: "in-progress" }),
    item({ id: "i3", realization: "to-do" }),
    item({ id: "i4", realization: "cancelled" }),
    item({ id: "iX", realization: "done" }), // unmapped -> ignored
  ];
  const map = [
    { itemId: "i1", wpCode: "WP1" as const },
    { itemId: "i2", wpCode: "WP1" as const },
    { itemId: "i3", wpCode: "WP2" as const },
    { itemId: "i4", wpCode: "WP2" as const },
  ];

  it("rolls counts up by WP and ignores unmapped items", () => {
    const p = projectLive(items, map);
    expect(p.source).toBe("live");
    const wp1 = p.swimlanes.find((l) => l.wp === "WP1")!;
    expect(wp1.total).toBe(2);
    expect(wp1.done).toBe(1);
    expect(wp1.in_progress).toBe(1);
    expect(wp1.pctDone).toBe(50); // 1 done / 2 (none dropped)
    const wp2 = p.swimlanes.find((l) => l.wp === "WP2")!;
    expect(wp2.total).toBe(2);
    expect(wp2.dropped).toBe(1);
    expect(wp2.pctDone).toBe(0); // 0 done / (2-1 dropped)
    // unmapped iX absent from titles
    expect(p.titles.iX).toBeUndefined();
  });

  it("emits a now scale (WIP) and a project scale (fait/ouvert)", () => {
    const p = projectLive(items, map);
    expect(Object.keys(p.scales).sort()).toEqual(["now", "project"]);
    expect(p.scales.now!.byWp.WP1.fait).toEqual(["i2"]); // only in-progress
    expect(p.scales.project!.byWp.WP1.fait).toEqual(["i1"]); // done
    expect(p.scales.project!.byWp.WP1.ouvert).toEqual(["i2"]); // open
  });

  it("emits a flat per-item list with WP + status + now membership", () => {
    const p = projectLive(items, map);
    // mapped items only (iX unmapped is absent)
    expect(p.items.map((i) => i.id).sort()).toEqual(["i1", "i2", "i3", "i4"]);
    const i1 = p.items.find((i) => i.id === "i1")!;
    expect(i1.wp).toBe("WP1");
    expect(i1.status).toBe("done");
    expect(i1.scales).toEqual([]); // done -> not in the "now" window
    const i2 = p.items.find((i) => i.id === "i2")!;
    expect(i2.status).toBe("in_progress");
    expect(i2.scales).toEqual(["now"]); // in-progress WIP -> now window
  });

  it("returns all 6 WP swimlanes in order", () => {
    const p = projectLive(items, map);
    expect(p.swimlanes.map((l) => l.wp)).toEqual([...WP_ORDER]);
  });
});

describe("projectSubLanes", () => {
  const items: TrackItem[] = [
    item({ id: "i1", realization: "done" }),
    item({ id: "i2", realization: "in-progress" }),
    item({ id: "i3", realization: "to-do" }),
  ];
  const catalog = [
    { code: "WP1.1", wp: "WP1" as const, subItemId: "S11", title: "WP1.1 A" },
    { code: "WP1.2", wp: "WP1" as const, subItemId: "S12", title: "WP1.2 B" },
    { code: "WP2.1", wp: "WP2" as const, subItemId: "S21", title: "WP2.1 C" },
  ];
  const entries = [
    { itemId: "i1", wp: "WP1" as const, subItem: "WP1.1", subItemId: "S11", title: "x" },
    { itemId: "i2", wp: "WP1" as const, subItem: "WP1.1", subItemId: "S11", title: "y" },
    { itemId: "i3", wp: "WP2" as const, subItem: "WP2.1", subItemId: "S21", title: "z" },
  ];

  it("rolls items into WPx.y sub-lanes, keeps empty lanes, counts statuses", () => {
    const lanes = projectSubLanes(items, entries, catalog);
    expect(lanes.WP1.map((l) => l.subItem)).toEqual(["WP1.1", "WP1.2"]);
    const wp11 = lanes.WP1.find((l) => l.subItem === "WP1.1")!;
    expect(wp11.total).toBe(2);
    expect(wp11.done).toBe(1);
    expect(wp11.in_progress).toBe(1);
    expect(wp11.pctDone).toBe(50);
    // empty sub-lane preserved with zero counts
    const wp12 = lanes.WP1.find((l) => l.subItem === "WP1.2")!;
    expect(wp12.total).toBe(0);
    expect(wp12.pctDone).toBeNull();
    expect(lanes.WP2.find((l) => l.subItem === "WP2.1")!.planned).toBe(1);
  });

  it("emits an array (possibly empty) for every WP code", () => {
    const lanes = projectSubLanes(items, entries, catalog);
    for (const wp of WP_ORDER) expect(Array.isArray(lanes[wp])).toBe(true);
  });
});

describe("buildProjItems", () => {
  const items: TrackItem[] = [
    item({ id: "a", realization: "done" }),
    item({ id: "b", realization: "in-progress" }),
    item({ id: "c", realization: "to-do" }),
    item({ id: "z", realization: "done" }), // unmapped
  ];
  const map = [
    { itemId: "a", wpCode: "WP1" as const },
    { itemId: "b", wpCode: "WP1" as const },
    { itemId: "c", wpCode: "WP2" as const },
  ];
  const sub = [
    { itemId: "a", wp: "WP1" as const, subItem: "WP1.1", subItemId: "S11", title: "a" },
  ];

  it("derives scale membership from the scale views (now/week/month windows)", () => {
    const scales = {
      now: {
        scale: "now" as const,
        byWp: {
          WP1: { fait: ["b"], ouvert: [] },
          WP2: { fait: [], ouvert: [] },
          WP3: { fait: [], ouvert: [] },
          WP4: { fait: [], ouvert: [] },
          WP5: { fait: [], ouvert: [] },
          WP6: { fait: [], ouvert: [] },
        },
      },
      week: {
        scale: "week" as const,
        byWp: {
          WP1: { fait: ["a"], ouvert: ["b"] },
          WP2: { fait: [], ouvert: [] },
          WP3: { fait: [], ouvert: [] },
          WP4: { fait: [], ouvert: [] },
          WP5: { fait: [], ouvert: [] },
          WP6: { fait: [], ouvert: [] },
        },
      },
    };
    const out = buildProjItems(items, map, sub, scales);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]); // unmapped z dropped
    const a = out.find((i) => i.id === "a")!;
    expect(a.wp).toBe("WP1");
    expect(a.subItem).toBe("WP1.1");
    expect(a.scales).toEqual(["week"]); // in week, not now
    const b = out.find((i) => i.id === "b")!;
    expect(b.scales).toEqual(["now", "week"]); // both windows
    const c = out.find((i) => i.id === "c")!;
    expect(c.scales).toEqual([]); // no window contains c
    expect(c.subItem).toBeUndefined(); // no sub-map entry
  });

  it("yields empty scale membership when no scale views are provided", () => {
    const out = buildProjItems(items, map, null, {});
    for (const i of out) expect(i.scales).toEqual([]);
  });
});
