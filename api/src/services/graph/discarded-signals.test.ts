/** LOT 2 — discarded-signal predicate unit tests (no storage, no DB). */

import { describe, it, expect } from "vitest";
import {
  EMPTY_DISCARDED_KEYS,
  EMPTY_DISCARDED_SIGNALS,
  discardedSignalKey,
  filterDiscardedSignals,
  type DiscardedSignalsPort,
} from "./discarded-signals.js";

const node = (id: string, citySlug: string | null, type = "Signal") => ({
  id,
  citySlug,
  type,
  label: `Node ${id}`,
});

describe("discardedSignalKey", () => {
  it("uses the native triple verbatim, with no gn prefix", () => {
    const key = discardedSignalKey("drummondville", "Signal", "sig-001");
    expect(key).toContain("drummondville");
    expect(key).toContain("Signal");
    expect(key).toContain("sig-001");
    expect(key.startsWith("gn-")).toBe(false);
  });

  it("assigns distinct keys to triples sharing one concatenation", () => {
    const keys = [
      discardedSignalKey("ab", "c", "d"),
      discardedSignalKey("a", "bc", "d"),
      discardedSignalKey("a", "b", "cd"),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it("rejects unbranded strings where a key is expected", () => {
    const port: DiscardedSignalsPort = {
      // @ts-expect-error — raw strings are not discard keys
      forViewer: async () => new Set(["drummondville|Signal|sig-001"]),
    };
    expect(port.forViewer(null)).toBeInstanceOf(Promise);
  });
});

describe("EMPTY_DISCARDED_SIGNALS", () => {
  it("resolves the shared empty set for anonymous and named viewers", async () => {
    expect(await EMPTY_DISCARDED_SIGNALS.forViewer(null)).toBe(EMPTY_DISCARDED_KEYS);
    expect((await EMPTY_DISCARDED_SIGNALS.forViewer("viewer-1")).size).toBe(0);
  });
});

describe("filterDiscardedSignals", () => {
  const discarded = new Set([discardedSignalKey("drummondville", "Signal", "sig-001")]);

  it("removes exactly the discarded triple and keeps everything when empty", () => {
    const items = [node("sig-001", "drummondville"), node("sig-002", "drummondville"), node("sig-001", "sutton"), node("sig-001", "drummondville", "DesignationEvent")];
    expect(filterDiscardedSignals(items, discarded)).toEqual([
      node("sig-002", "drummondville"),
      node("sig-001", "sutton"),
      node("sig-001", "drummondville", "DesignationEvent"),
    ]);
    expect(filterDiscardedSignals(items, new Set())).toEqual(items);
  });

  it("still removes a node recreated with the same native key", () => {
    expect(
      filterDiscardedSignals([{ ...node("sig-001", "drummondville"), label: "Recreated" }], discarded),
    ).toEqual([]);
  });

  it("never discards a node without a city (no native triple)", () => {
    const items = [node("sig-001", null)];
    expect(
      filterDiscardedSignals(items, new Set([discardedSignalKey("", "Signal", "sig-001")])),
    ).toEqual(items);
  });
});
