/**
 * 6H scoped UI context: every facet intention carries the viewer incarnation
 * and the selected workspace. Late responses from another context (account
 * switch, logout, workspace switch) are discarded by the owner. No screen,
 * selection, or account value is ever inferred as a destination.
 */

export interface ScopedViewerContext {
  /** Fresh identity per viewer transition, including a return to the same sub. */
  viewerKey: { context: string } | null;
  /** Explicitly selected workspace; never defaulted. */
  workspaceId: string | null;
}

export function emptyScopedViewerContext(): ScopedViewerContext {
  return { viewerKey: null, workspaceId: null };
}

export class ScopedContextError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** The launch context must carry an explicit workspace before any POST. */
export function assertScopedLaunchContext(context: ScopedViewerContext): string {
  if (context.viewerKey === null || context.workspaceId === null) {
    throw new ScopedContextError("missing_scoped_context");
  }
  return context.workspaceId;
}

/**
 * True only when the response context still matches the live context:
 * same viewer incarnation and same workspace. Late responses are dropped.
 */
export function isLiveScopedContext(
  launched: ScopedViewerContext, current: ScopedViewerContext,
): boolean {
  if (launched.viewerKey === null || current.viewerKey === null) return false;
  if (launched.workspaceId === null || current.workspaceId === null) return false;
  return launched.viewerKey.context === current.viewerKey.context
    && launched.workspaceId === current.workspaceId;
}
