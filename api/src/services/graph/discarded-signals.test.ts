/** LOT 2 — discarded-signal predicate unit tests (no storage, no DB). */

import { describe, it, expect } from "vitest";
import {
  EMPTY_DISCARDED_SIGNALS,
  discardedSignalKey,
  filterDiscardedSignals,
  resolveGraphSignalsViewer,
} from "./discarded-signals.js";

const node = (id: string, citySlug: string | null, type = "Signal") => ({
  id,
  citySlug,
  type,
  label: `Node ${id}`,
});

describe("discardedSignalKey", () => {
  it("encodes the native triple verbatim, with no gn prefix", () => {
    const sep = String.fromCharCode(0);
    expect(discardedSignalKey("drummondville", "Signal", "sig-001")).toBe(
      `drummondville${sep}Signal${sep}sig-001`,
    );
  });
});

describe("EMPTY_DISCARDED_SIGNALS", () => {
  it("returns an empty set for anonymous and named viewers", () => {
    expect(EMPTY_DISCARDED_SIGNALS.forViewer(null).size).toBe(0);
    expect(EMPTY_DISCARDED_SIGNALS.forViewer("viewer-1").size).toBe(0);
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

  it("does not match display IDs or legacy UUIDs against a native node ID", () => {
    const items = [node("sig-001", "drummondville")];
    const aliases = new Set([
      discardedSignalKey("drummondville", "Signal", "gn-sig-001"),
      discardedSignalKey("drummondville", "Signal", "550e8400-e29b-41d4-a716-446655440000"),
    ]);
    expect(filterDiscardedSignals(items, aliases)).toEqual(items);
  });

  it("still removes a node recreated with the same native key", () => {
    expect(
      filterDiscardedSignals([{ ...node("sig-001", "drummondville"), label: "Recreated" }], discarded),
    ).toEqual([]);
  });
});

describe("resolveGraphSignalsViewer", () => {
  it("returns the session sub, else null", () => {
    expect(resolveGraphSignalsViewer({ get: () => ({ sub: "viewer-1" }) })).toBe("viewer-1");
    expect(resolveGraphSignalsViewer({ get: () => undefined })).toBeNull();
    expect(resolveGraphSignalsViewer({ get: () => ({ sub: 42 }) })).toBeNull();
    expect(resolveGraphSignalsViewer({})).toBeNull();
    expect(resolveGraphSignalsViewer({ get: () => { throw new Error("no session"); } })).toBeNull();
  });
});
