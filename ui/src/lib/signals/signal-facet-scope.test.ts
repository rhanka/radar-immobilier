/**
 * 6H scoped UI context: late responses from another viewer incarnation or
 * workspace are discarded; launches without explicit context are refused.
 * A reconnection to the same account mints a fresh viewer key object, so
 * responses from the previous incarnation are dropped.
 */
import { describe, expect, it } from "vitest";
import {
  assertScopedLaunchContext,
  emptyScopedViewerContext,
  isLiveScopedContext,
  ScopedContextError,
  type ScopedViewerContext,
} from "./signal-facet-scope.js";

const workspace = "11111111-1111-1111-1111-111111111111";
const otherWorkspace = "22222222-2222-2222-2222-222222222222";

function viewer(label: string) {
  return { context: label };
}

function context(viewerKey: { context: string }, workspaceId: string | null): ScopedViewerContext {
  return { viewerKey, workspaceId };
}

describe("assertScopedLaunchContext", () => {
  it("refuses launches without an explicit workspace", () => {
    expect(() => assertScopedLaunchContext(emptyScopedViewerContext()))
      .toThrowError(ScopedContextError);
    expect(() => assertScopedLaunchContext(context(viewer("viewer-1"), null)))
      .toThrowError("missing_scoped_context");
  });

  it("accepts a launch carrying viewer incarnation and workspace", () => {
    expect(assertScopedLaunchContext(context(viewer("viewer-1"), workspace))).toBe(workspace);
  });
});

describe("isLiveScopedContext", () => {
  it("keeps responses from the same viewer incarnation and workspace", () => {
    const incarnation = viewer("viewer-1");
    expect(isLiveScopedContext(context(incarnation, workspace), context(incarnation, workspace)))
      .toBe(true);
  });

  it("discards late responses after a viewer transition", () => {
    expect(isLiveScopedContext(context(viewer("viewer-1"), workspace), context(viewer("viewer-2"), workspace)))
      .toBe(false);
  });

  it("discards late responses after reconnecting to the same account", () => {
    const launched = context(viewer("account-a"), workspace);
    const reconnected = context(viewer("account-a"), workspace);
    expect(isLiveScopedContext(launched, reconnected)).toBe(false);
  });

  it("discards late responses after a workspace switch", () => {
    const incarnation = viewer("viewer-1");
    expect(isLiveScopedContext(context(incarnation, workspace), context(incarnation, otherWorkspace)))
      .toBe(false);
  });

  it("discards responses when either context is empty", () => {
    const live = context(viewer("viewer-1"), workspace);
    expect(isLiveScopedContext(emptyScopedViewerContext(), live)).toBe(false);
    expect(isLiveScopedContext(live, emptyScopedViewerContext())).toBe(false);
  });
});
