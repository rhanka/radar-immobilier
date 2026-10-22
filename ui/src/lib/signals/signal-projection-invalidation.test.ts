/**
 * 6L2 invalidation signals: frame parsing, gated signal decisions, cursor
 * adoption and acknowledgment guards. Pure unit tests, no DOM source.
 */
import { describe, expect, it } from "vitest";
import {
  beginInvalidationFetch,
  buildProjectionEventsUrl,
  createProjectionInvalidationSync,
  noteInvalidationEvent,
  noteInvalidationReconciled,
  parseProjectionStreamEvent,
  shouldFetchAfterEvent,
  type ProjectionInvalidationContext,
} from "./signal-projection-invalidation.js";

const workspace = "11111111-1111-1111-1111-111111111111";

function context(label: string, workspaceId: string | null = workspace): ProjectionInvalidationContext {
  return { viewerKey: { context: label }, workspaceId, citySlug: "synthetic-city", mode: "signal" };
}

function enabled(label = "viewer-1") {
  return createProjectionInvalidationSync(context(label), { enabled: true });
}

describe("parseProjectionStreamEvent", () => {
  it("should parse named frames and reject unknown or malformed frames", () => {
    expect(parseProjectionStreamEvent("invalidated", '{"token":"a"}'))
      .toEqual({ kind: "invalidated", token: "a" });
    expect(parseProjectionStreamEvent("resync", '{"token":"a","cursor":"c"}'))
      .toEqual({ kind: "resync", token: "a", cursor: "c" });
    expect(parseProjectionStreamEvent("closed", '{"reason":"revoked"}')).toEqual({ kind: "closed" });
    expect(parseProjectionStreamEvent("ping", "{}")).toEqual({ kind: "ping" });
    expect(parseProjectionStreamEvent("invalidated", "nope")).toBeNull();
    expect(parseProjectionStreamEvent("business", '{"token":"a"}')).toBeNull();
    expect(parseProjectionStreamEvent("invalidated", "{}")).toBeNull();
  });
});

describe("buildProjectionEventsUrl", () => {
  it("should scope the stream under the workspace and carry the cursor", () => {
    const withCursor = buildProjectionEventsUrl("", { workspaceId: workspace,
      citySlug: "synthetic-city", mode: "signal", cursor: "cursor-a" });
    expect(withCursor).toContain(`/api/v1/workspaces/${workspace}/signal-facets/projection-events?`);
    expect(withCursor).toContain("cursor=cursor-a");
    const lost = buildProjectionEventsUrl("", { workspaceId: workspace,
      citySlug: "synthetic-city", mode: "signal", cursor: null });
    expect(lost).not.toContain("cursor=");
  });
});

describe("noteInvalidationEvent", () => {
  it("should stay dormant while the gate is closed or the context is empty", () => {
    const gated = createProjectionInvalidationSync(context("viewer-1"));
    expect(noteInvalidationEvent(gated, context("viewer-1"), { kind: "resync" })).toBe("ignore");
    const homeless = createProjectionInvalidationSync(context("viewer-1", null), { enabled: true });
    expect(noteInvalidationEvent(homeless, context("viewer-1", null), { kind: "resync" })).toBe("ignore");
  });

  it("should ignore late events after a viewer transition or workspace switch", () => {
    const state = enabled();
    expect(noteInvalidationEvent(state, context("viewer-2"), { kind: "resync" })).toBe("ignore");
    expect(noteInvalidationEvent(state,
      { viewerKey: state.launched.viewerKey!, workspaceId: "22222222-2222-2222-2222-222222222222",
        citySlug: "synthetic-city", mode: "signal" },
      { kind: "resync" })).toBe("ignore");
    expect(state.cursor).toBeNull();
  });

  it("should fetch once per token and resync with cursor adoption", () => {
    const state = enabled();
    const live = state.launched;
    expect(noteInvalidationEvent(state, live,
      { kind: "invalidated", token: "token-a" })).toBe("fetch");
    expect(noteInvalidationReconciled(state, live, { token: "token-a" },
      beginInvalidationFetch(state))).toBe(true);
    expect(shouldFetchAfterEvent(state, "token-a")).toBe(false);
    expect(noteInvalidationEvent(state, live,
      { kind: "invalidated", token: "token-a" })).toBe("ignore");
    expect(noteInvalidationEvent(state, live,
      { kind: "resync", token: "token-b", cursor: "cursor-b" })).toBe("resync");
    expect(state.cursor).toBe("cursor-b");
  });

  it("should clear the local copy when the watcher closes the stream", () => {
    const state = enabled();
    state.cursor = "cursor-a";
    expect(noteInvalidationEvent(state, state.launched, { kind: "closed" })).toBe("closed");
    expect(state.ackedToken).toBeNull();
    expect(state.cursor).toBeNull();
  });

  it("should ignore pings, unavailable scopes and unknown frames", () => {
    const state = enabled();
    expect(noteInvalidationEvent(state, context("viewer-1"), { kind: "ping" })).toBe("ignore");
    expect(noteInvalidationEvent(state, context("viewer-1"), { kind: "unavailable" })).toBe("ignore");
    expect(noteInvalidationEvent(state, context("viewer-1"), null)).toBe("ignore");
  });
});
