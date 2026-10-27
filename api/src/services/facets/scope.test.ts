/**
 * 6H scope identity tests: per-workspace stream isolation, explicit D3
 * mapping decisions, and the closed-until-activated gate. Synthetic ids only.
 */
import { describe, expect, it } from "vitest";
import {
  decideAttachment,
  requireScopedEpoch,
  ScopeError,
  streamKey,
  assertStreamIdentity,
  type StreamIdentity,
} from "./scope.js";

const base: StreamIdentity = {
  workspaceId: "11111111-1111-1111-1111-111111111111",
  scope: "personal",
  ownerId: "22222222-2222-2222-2222-222222222222",
  targetType: "signal",
  citySlug: "lyon",
  nodeType: "Signal",
  nodeId: "sig-1",
  facet: "selection",
  basket: "pertinent",
};

describe("streamKey", () => {
  it("separates the same account and target across two workspaces", () => {
    const left = streamKey(base);
    const right = streamKey({ ...base, workspaceId: "33333333-3333-3333-3333-333333333333" });
    expect(left).not.toBe(right);
  });

  it("separates archive streams with a null basket from selections", () => {
    const archive: StreamIdentity = { ...base, facet: "archive", basket: null };
    expect(streamKey(base)).not.toBe(streamKey(archive));
  });

  it("rejects archive streams carrying a basket and selections without one", () => {
    expect(() => assertStreamIdentity({ ...base, facet: "archive", basket: "pertinent" }))
      .toThrowError(ScopeError);
    expect(() => assertStreamIdentity({ ...base, facet: "selection", basket: null }))
      .toThrowError(ScopeError);
  });
});

describe("decideAttachment", () => {
  const account = "22222222-2222-2222-2222-222222222222";
  const first = "11111111-1111-1111-1111-111111111111";
  const second = "33333333-3333-3333-3333-333333333333";

  it("attaches one explicit destination per account", () => {
    expect(decideAttachment(account, [first])).toEqual({ kind: "attach", workspaceId: first });
  });

  it("leaves ambiguous histories pending without converting scope", () => {
    const decision = decideAttachment(account, [first, second]);
    expect(decision.kind).toBe("pending-ambiguous");
    if (decision.kind === "pending-ambiguous") {
      expect(decision.workspaceIds).toEqual([first, second].sort());
    }
  });

  it("leaves accounts without a destination pending", () => {
    expect(decideAttachment(account, [])).toEqual({ kind: "pending-ambiguous", workspaceIds: [] });
  });
});

describe("requireScopedEpoch", () => {
  it("keeps scoped reads unavailable before activation", () => {
    expect(() => requireScopedEpoch("legacy", "ws")).toThrowError(ScopeError);
    expect(() => requireScopedEpoch(null, "ws")).toThrowError(ScopeError);
    expect(() => requireScopedEpoch("scoped", "ws")).not.toThrow();
  });
});
