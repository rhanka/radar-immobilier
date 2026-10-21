/**
 * 6H scoped UI context: late responses from another viewer incarnation or
 * workspace are discarded; launches without explicit context are refused.
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

function context(viewer: string, workspaceId: string | null): ScopedViewerContext {
  return { viewerKey: { context: viewer }, workspaceId };
}

describe("assertScopedLaunchContext", () => {
  it("refuses launches without an explicit workspace", () => {
    expect(() => assertScopedLaunchContext(emptyScopedViewerContext()))
      .toThrowError(ScopedContextError);
    expect(() => assertScopedLaunchContext(context("viewer-1", null)))
      .toThrowError("missing_scoped_context");
  });

  it("accepts a launch carrying viewer incarnation and workspace", () => {
    expect(assertScopedLaunchContext(context("viewer-1", workspace))).toBe(workspace);
  });
});

describe("isLiveScopedContext", () => {
  it("keeps responses from the same viewer incarnation and workspace", () => {
    expect(isLiveScopedContext(context("viewer-1", workspace), context("viewer-1", workspace)))
      .toBe(true);
  });

  it("discards late responses after a viewer transition", () => {
    expect(isLiveScopedContext(context("viewer-1", workspace), context("viewer-2", workspace)))
      .toBe(false);
  });

  it("discards late responses after a workspace switch", () => {
    expect(isLiveScopedContext(context("viewer-1", workspace), context("viewer-1", otherWorkspace)))
      .toBe(false);
  });

  it("discards responses when either context is empty", () => {
    const live = context("viewer-1", workspace);
    expect(isLiveScopedContext(emptyScopedViewerContext(), live)).toBe(false);
    expect(isLiveScopedContext(live, emptyScopedViewerContext())).toBe(false);
  });
});
