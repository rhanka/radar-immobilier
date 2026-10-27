import { describe, expect, it } from "vitest";
import {
  discardedSignalKey,
  filterDiscardedSignals,
  unionDiscardedSignals,
} from "../graph/discarded-signals.js";

describe("6I discard union and projection parity", () => {
  it("should hide union keys before aggregation while preserving kept order", () => {
    const rows = [
      { citySlug: "ville-a", type: "Signal", id: "one" },
      { citySlug: "ville-a", type: "Signal", id: "two" },
      { citySlug: "ville-a", type: "DesignationEvent", id: "three" },
    ];
    const workspace = new Set([discardedSignalKey("ville-a", "Signal", "two")]);
    const personal = new Set([discardedSignalKey("ville-a", "DesignationEvent", "three")]);
    const union = unionDiscardedSignals(workspace, personal);
    expect(filterDiscardedSignals(rows, union)).toEqual([rows[0]]);
    expect(filterDiscardedSignals(rows, unionDiscardedSignals(undefined, undefined))).toEqual(rows);
    expect(filterDiscardedSignals(rows, unionDiscardedSignals(workspace, workspace))).toHaveLength(2);
  });
});
