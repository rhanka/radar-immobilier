import { describe, expect, it } from "vitest";

import {
  rollupForScale,
  type WpProjection,
  type WpRollup,
} from "./wp-projection-client.js";

function lane(over: Partial<WpRollup> & { wp: WpRollup["wp"] }): WpRollup {
  return {
    title: over.title ?? over.wp,
    total: 0,
    done: 0,
    needs_review: 0,
    in_progress: 0,
    planned: 0,
    blocked: 0,
    dropped: 0,
    pctDone: null,
    ...over,
  };
}

function projection(): WpProjection {
  return {
    available: true,
    source: "precomputed",
    generatedAt: "2026-06-28T00:00:00Z",
    swimlanes: [
      lane({
        wp: "WP1",
        title: "DATA",
        total: 3,
        done: 1,
        in_progress: 1,
        planned: 1,
        pctDone: 33,
        subLanes: [
          {
            subItem: "WP1.1",
            subItemId: "S11",
            title: "WP1.1 A",
            total: 2,
            done: 1,
            needs_review: 0,
            in_progress: 1,
            planned: 0,
            blocked: 0,
            dropped: 0,
            pctDone: 50,
          },
          {
            subItem: "WP1.2",
            subItemId: "S12",
            title: "WP1.2 B",
            total: 1,
            done: 0,
            needs_review: 0,
            in_progress: 0,
            planned: 1,
            blocked: 0,
            dropped: 0,
            pctDone: 0,
          },
        ],
      }),
      lane({ wp: "WP2", title: "EXTRACTION", total: 1, in_progress: 1, pctDone: 0 }),
      lane({ wp: "WP3", title: "RECO" }),
      lane({ wp: "WP4", title: "PRODUIT" }),
      lane({ wp: "WP5", title: "PLATEFORME" }),
      lane({ wp: "WP6", title: "GOUV" }),
    ],
    scales: {},
    items: [
      { id: "a", wp: "WP1", subItem: "WP1.1", status: "done", scales: ["week", "month"] },
      { id: "b", wp: "WP1", subItem: "WP1.1", status: "in_progress", scales: ["now", "week"] },
      { id: "c", wp: "WP1", subItem: "WP1.2", status: "planned", scales: ["month"] },
      { id: "d", wp: "WP2", status: "in_progress", scales: ["now", "week", "month"] },
    ],
    titles: {},
  };
}

describe("rollupForScale", () => {
  it("project (Global) returns the authoritative server swimlanes unchanged", () => {
    const p = projection();
    expect(rollupForScale(p, "project")).toBe(p.swimlanes);
  });

  it("now recounts only in_progress WIP items per WP", () => {
    const lanes = rollupForScale(projection(), "now");
    const wp1 = lanes.find((l) => l.wp === "WP1")!;
    expect(wp1.total).toBe(1); // only b
    expect(wp1.in_progress).toBe(1);
    expect(wp1.done).toBe(0);
    const wp2 = lanes.find((l) => l.wp === "WP2")!;
    expect(wp2.total).toBe(1); // d
    // every WP swimlane still rendered (incl. empty)
    expect(lanes.map((l) => l.wp)).toEqual(["WP1", "WP2", "WP3", "WP4", "WP5", "WP6"]);
  });

  it("week recounts the window across statuses and keeps WP1 sub-lanes", () => {
    const lanes = rollupForScale(projection(), "week");
    const wp1 = lanes.find((l) => l.wp === "WP1")!;
    expect(wp1.total).toBe(2); // a (done) + b (in_progress)
    expect(wp1.done).toBe(1);
    expect(wp1.in_progress).toBe(1);
    expect(wp1.pctDone).toBe(50); // 1 done / 2
    const sub11 = wp1.subLanes!.find((s) => s.subItem === "WP1.1")!;
    expect(sub11.total).toBe(2);
    const sub12 = wp1.subLanes!.find((s) => s.subItem === "WP1.2")!;
    expect(sub12.total).toBe(0); // c is month-only, not week
  });

  it("month includes the planned item c in WP1", () => {
    const lanes = rollupForScale(projection(), "month");
    const wp1 = lanes.find((l) => l.wp === "WP1")!;
    expect(wp1.total).toBe(2); // a + c
    expect(wp1.planned).toBe(1);
    expect(wp1.done).toBe(1);
  });
});
