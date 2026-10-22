/**
 * 6L1 projection reconciliation coordinator: an authorized viewer detects
 * staleness through revision tokens and reloads coherently.
 *
 * Context guards stay the reference: every acknowledgment requires the
 * response context to still match the live viewer incarnation (`viewerKey`
 * object identity) and the selected workspace. Late responses from another
 * incarnation or workspace are ignored; a failed read retains the last
 * acknowledged snapshot so the UI never renders a partial state.
 */

import {
  isLiveScopedContext,
  type ScopedViewerContext,
} from "./signal-facet-scope.js";

export interface ProjectionSnapshot {
  /** Revision token acknowledged with this snapshot. */
  token: string;
}

export interface ProjectionContext extends ScopedViewerContext {
  citySlug: string;
  mode: string;
}

export interface ProjectionSyncState<T extends ProjectionSnapshot = ProjectionSnapshot> {
  launched: ProjectionContext;
  ackedToken: string | null;
  snapshot: T | null;
  operation: number;
}

export function createProjectionSync<T extends ProjectionSnapshot = ProjectionSnapshot>(
  launched: ProjectionContext,
): ProjectionSyncState<T> {
  return { launched: { ...launched }, ackedToken: null, snapshot: null, operation: 0 };
}

/** True when the remote token differs from the last acknowledged token. */
export function shouldReconcile(state: ProjectionSyncState, remoteToken: string): boolean {
  return state.ackedToken !== remoteToken;
}

/**
 * Acknowledge a successful coherent read. Returns true only when the
 * response context is still live; superseded responses change nothing.
 */
export function beginProjectionRead(state: ProjectionSyncState): number {
  return ++state.operation;
}

export function noteProjectionSuccess<T extends ProjectionSnapshot>(
  state: ProjectionSyncState<T>, live: ProjectionContext,
  snapshot: T, operation: number,
): boolean {
  if (!isLiveScopedContext(state.launched, live)) return false;
  if (state.launched.citySlug !== live.citySlug || state.launched.mode !== live.mode) return false;
  if (operation !== state.operation) return false;
  state.ackedToken = snapshot.token;
  state.snapshot = snapshot;
  return true;
}

/** Last acknowledged snapshot; unchanged by failed or superseded reads. */
export function retainedSnapshot<T extends ProjectionSnapshot>(state: ProjectionSyncState<T>): T | null {
  return state.snapshot;
}

/**
 * Reconcile one fetch against the live context. The caller may supply the
 * operation begun before the fetch so a later guard can detect a disposal
 * or a superseding read that landed after validation.
 */
export async function reconcileProjection<T extends ProjectionSnapshot>(
  state: ProjectionSyncState<T>, live: () => ProjectionContext, fetch: () => Promise<T>,
  operation: number = beginProjectionRead(state),
): Promise<boolean> {
  const snapshot = await fetch();
  return noteProjectionSuccess(state, live(), snapshot, operation);
}

/** Dormant until a scoped screen supplies its authorized coherent loader. */
export function observeProjection<T extends ProjectionSnapshot>(
  state: ProjectionSyncState<T>, live: () => ProjectionContext, fetch: () => Promise<T>,
  rebuild: (snapshot: T) => void, target: Window = window,
): { refresh: () => Promise<void>; dispose: () => void } {
  let disposed = false;
  const refresh = async () => {
    const operation = beginProjectionRead(state);
    const snapshot = await fetch();
    // Single synchronous sequence with no suspension between the final
    // validation, the acknowledgment, and the application: a discarded
    // response acknowledges nothing, so a later failure keeps the last
    // displayed snapshot and its token consistent.
    if (disposed) return;
    const current = live();
    if (!isLiveScopedContext(state.launched, current)) return;
    if (state.launched.citySlug !== current.citySlug || state.launched.mode !== current.mode) return;
    if (state.operation !== operation) return;
    state.ackedToken = snapshot.token;
    state.snapshot = snapshot;
    rebuild(snapshot);
  };
  const wake = () => { void refresh().catch(() => {}); };
  const visible = () => { if (target.document.visibilityState === "visible") wake(); };
  for (const event of ["focus", "online", "pageshow"]) target.addEventListener(event, wake);
  target.document.addEventListener("visibilitychange", visible);
  return { refresh, dispose: () => {
    if (!disposed) {
      disposed = true;
      ++state.operation;
    }
    for (const event of ["focus", "online", "pageshow"]) target.removeEventListener(event, wake);
    target.document.removeEventListener("visibilitychange", visible);
  } };
}
