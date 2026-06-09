import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  bucketForRealization,
  foldTrackEvents,
  loadTrackItems,
  resolveTrackEventsPath,
  type TrackItem,
} from "./track-reader.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(here, "__fixtures__", "track-events.sample.jsonl");
const FIXTURE = readFileSync(FIXTURE_PATH, "utf8");

// Stable real ids excerpted verbatim from `.track/events.jsonl`.
const DONE_ID = "01KTMHTE8YCBE0596AB6SJRYE4"; // WP4-A — realization done, acceptance pass
const TODO_ID = "01KTMHWNQZ1EYEDAM2Z7PVK1N3"; // WP5 write-core — created only
const IN_PROGRESS_ID = "01KTNXDJ6EN4WXBFKVYCZJF6E2"; // Backlog <-> track — in-progress

const byId = (items: TrackItem[], id: string): TrackItem | undefined =>
  items.find((i) => i.id === id);

describe("foldTrackEvents (real fixture)", () => {
  const items = foldTrackEvents(FIXTURE);

  it("folds every created aggregate exactly once", () => {
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
  });

  it("a DONE item folds to bucket DONE with acceptance pass", () => {
    const done = byId(items, DONE_ID);
    expect(done).toBeDefined();
    expect(done?.realization).toBe("done");
    expect(done?.bucket).toBe("DONE");
    expect(done?.acceptance).toBe("pass");
    // Title + workspace come verbatim from item.created (anti-invention).
    expect(done?.title).toBe("WP4-A — Investigation données réelles multi-villes");
    expect(done?.workspace).toBe("wp4-sources");
    expect(done?.kind).toBe("feature");
  });

  it("a created-only item folds to bucket TO-DO (no realization)", () => {
    const todo = byId(items, TODO_ID);
    expect(todo).toBeDefined();
    expect(todo?.realization).toBe("to-do");
    expect(todo?.bucket).toBe("TO-DO");
    expect(todo?.acceptance).toBe("none");
    expect(todo?.workspace).toBe("wp5-ontology");
  });

  it("an in-progress item folds to bucket TO-DO with realization in-progress", () => {
    const ip = byId(items, IN_PROGRESS_ID);
    expect(ip).toBeDefined();
    expect(ip?.realization).toBe("in-progress");
    expect(ip?.bucket).toBe("TO-DO");
    expect(ip?.workspace).toBe("wp6-platform");
  });

  it("takes the LATEST realization transition (in-progress -> done wins done)", () => {
    // The DONE fixture has both in-progress (seq 6) and done (seq 7); done is latest.
    expect(byId(items, DONE_ID)?.realization).toBe("done");
  });

  it("omits parentId when absent from item.created (no fabrication)", () => {
    for (const item of items) {
      expect(item.parentId).toBeUndefined();
    }
  });

  it("preserves first-seen stream order", () => {
    expect(items.map((i) => i.id)).toEqual([DONE_ID, TODO_ID, IN_PROGRESS_ID]);
  });
});

describe("foldTrackEvents (robustness)", () => {
  it("returns [] for empty input", () => {
    expect(foldTrackEvents("")).toEqual([]);
  });

  it("skips malformed lines without throwing", () => {
    const text = `not json\n{"aggregate":"item"}\n${FIXTURE}`;
    expect(() => foldTrackEvents(text)).not.toThrow();
    expect(foldTrackEvents(text)).toHaveLength(3);
  });

  it("ignores non-item aggregates and orphan events", () => {
    const text =
      `{"aggregate":"other","aggregateId":"x","type":"item.created","payload":{}}\n` +
      `{"aggregate":"item","aggregateId":"orphan","at":"2026-01-01T00:00:00Z","type":"realization.transition","payload":{"to":"done"}}\n`;
    expect(foldTrackEvents(text)).toEqual([]);
  });
});

describe("bucketForRealization", () => {
  it("maps done -> DONE", () => {
    expect(bucketForRealization("done")).toBe("DONE");
  });
  it("maps cancelled / rejected -> DROPPED", () => {
    expect(bucketForRealization("cancelled")).toBe("DROPPED");
    expect(bucketForRealization("rejected")).toBe("DROPPED");
  });
  it("maps to-do / in-progress -> TO-DO", () => {
    expect(bucketForRealization("to-do")).toBe("TO-DO");
    expect(bucketForRealization("in-progress")).toBe("TO-DO");
  });
});

describe("resolveTrackEventsPath", () => {
  it("uses TRACK_EVENTS_PATH when set", () => {
    expect(resolveTrackEventsPath({ TRACK_EVENTS_PATH: "/tmp/x.jsonl" })).toBe(
      "/tmp/x.jsonl",
    );
  });

  it("falls back to the repo-root default when unset", () => {
    const resolved = resolveTrackEventsPath({});
    expect(resolved.endsWith("/.track/events.jsonl")).toBe(true);
  });
});

describe("loadTrackItems", () => {
  it("loads + folds when the path points at the fixture", () => {
    const result = loadTrackItems({ TRACK_EVENTS_PATH: FIXTURE_PATH });
    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(3);
  });

  it("degrades gracefully (available:false, items:[]) on a missing path", () => {
    const result = loadTrackItems({
      TRACK_EVENTS_PATH: "/nonexistent/track/events.jsonl",
    });
    expect(result.available).toBe(false);
    expect(result.items).toEqual([]);
  });
});
