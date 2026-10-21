/**
 * 6H activation qualification tests: only complete single-headed chains
 * bind; partial bindings, cross-stream linkage, orphan heads, and new
 * unbound events stay sealed. Synthetic chains only, no I/O.
 */
import { describe, expect, it } from "vitest";
import { qualifyChain } from "./activation.js";

function chain(ids: string[]) {
  return ids.map((id, index) => ({
    id,
    ownerId: "owner",
    citySlug: "lyon",
    nodeType: "Signal",
    nodeId: "sig-1",
    facet: "selection",
    basket: "pertinent" as string | null,
    supersedes: index === 0 ? null : ids[index - 1]!,
    supersededBy: index === ids.length - 1 ? null : ids[index + 1]!,
  }));
}

describe("qualifyChain", () => {
  it("binds a complete reciprocal chain", () => {
    expect(qualifyChain(chain(["a", "b", "c"]))).toEqual({ qualified: true, cause: null });
  });

  it("seals chains with several terminal events", () => {
    const events = [...chain(["a"]), ...chain(["b"])];
    expect(qualifyChain(events).qualified).toBe(false);
  });

  it("seals cyclic chains", () => {
    const events = chain(["a", "b"]);
    events[0]!.supersedes = "b";
    expect(qualifyChain(events).qualified).toBe(false);
  });

  it("seals non-reciprocal links", () => {
    const events = chain(["a", "b"]);
    events[0]!.supersededBy = "other";
    expect(qualifyChain(events).qualified).toBe(false);
  });

  it("seals cross-target links", () => {
    const events = chain(["a", "b"]);
    events[1]!.supersedes = "elsewhere";
    expect(qualifyChain(events).qualified).toBe(false);
  });

  it("seals chains mixing two streams", () => {
    const events = chain(["a", "b"]);
    events[1]!.basket = null;
    expect(qualifyChain(events)).toEqual({ qualified: false, cause: "cross-stream-linkage" });
    const sameHead = [
      { ...events[0]!, supersededBy: "b" },
      { ...events[1]!, id: "b", supersedes: "a", supersededBy: null, basket: null as string | null },
    ];
    expect(qualifyChain(sameHead).qualified).toBe(false);
  });
});
