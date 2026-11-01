import { get } from "svelte/store";
import { authStore } from "../auth/auth-store.js";
import { workspaceContext } from "../signals/workspace-client.js";
import { activeGeoRoute, activePageState, activeRouteView,
  navigateToGeoRoute, navigateToPageState } from "../router/router.js";
import { geographicTarget, projectContext, decodeSession } from "./ui-state-codecs.js";
import { SESSION_KEY } from "./ui-state-contract.js";
import { createUiStateSync } from "./ui-state-sync.js";
import { browserSyncChannel } from "./browser-channel.js";
import { currentServiceWorkerClient } from "../sw/client.js";

export function mountUiStateSync() {
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* operate in memory */ }
  const bus = browserSyncChannel((key) => sync.receive(key));
  const sync = createUiStateSync({ storage, origin: window.location.origin,
    notify(key) {
      bus.notify(key);
      const relay = currentServiceWorkerClient();
      if (!relay) return;
      if (key === SESSION_KEY) {
        const s = decodeSession(storage?.getItem(key) ?? "");
        if (s?.invalidated) void relay.notifySessionInvalidated({ partition: s.partition, epoch: s.sessionEpoch }).catch(() => undefined);
      } else void relay.notifyInvalidation({ scope: "context" }).catch(() => undefined);
    },
    snapshot() {
      const workspaceId = workspaceContext.current().context.workspaceId;
      if (!workspaceId) return null;
      const route = get(activeGeoRoute);
      const target = route ? geographicTarget(route) : { kind: "page" as const, view: get(activeRouteView) };
      return target ? { workspaceId, payload: projectContext(target, route?.state ?? get(activePageState)) } : null;
    },
    revalidate(invalidated) {
      if (invalidated) { authStore.invalidateSession(true); workspaceContext.reset(); }
      void authStore.checkSession(() => {
        try { return !decodeSession(storage?.getItem(SESSION_KEY) ?? "")?.invalidated; }
        catch { return true; }
      });
    },
    async validateWorkspace(workspaceId, sub) {
      await authStore.checkSession();
      const auth = get(authStore);
      if (!auth.authenticated || auth.user?.sub !== sub || auth.user.status !== "approved") return false;
      const state = await workspaceContext.load(sub);
      return state.sub === sub && state.workspaces.some((w) => w.id === workspaceId);
    },
    apply(workspaceId, { target, state }) {
      workspaceContext.select(workspaceId);
      if (target.kind === "geo") navigateToGeoRoute({ ...target.route, state });
      else navigateToPageState(target.view, state);
    },
  });
  const stop = [activeGeoRoute.subscribe(() => sync.schedule()), activePageState.subscribe(() => sync.schedule()),
    activeRouteView.subscribe(() => sync.schedule()), workspaceContext.subscribe(() => sync.schedule()),
    authStore.subscribe((auth) => {
      if (!auth.loading) void sync.account(auth.authenticated && !auth.authDisabled
        && auth.user?.status === "approved" && typeof auth.user.sub === "string"
        && auth.user.sub.length > 0 ? auth.user.sub : null);
    })];
  const wake = () => { if (document.visibilityState !== "hidden") sync.wake(); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("pageshow", wake);
  window.addEventListener("online", wake);
  const refresh = () => sync.refresh();
  const sessionInvalidated = () => sync.receive(SESSION_KEY);
  window.addEventListener("immo:coordination-invalidated", refresh);
  window.addEventListener("immo:session-invalidated", sessionInvalidated);
  const pagehide = () => sync.flush();
  window.addEventListener("pagehide", pagehide);
  return { ...sync, dispose() {
    sync.dispose(); bus.dispose(); stop.forEach((cleanup) => cleanup());
    document.removeEventListener("visibilitychange", wake); window.removeEventListener("pageshow", wake);
    window.removeEventListener("online", wake); window.removeEventListener("pagehide", pagehide);
    window.removeEventListener("immo:coordination-invalidated", refresh);
    window.removeEventListener("immo:session-invalidated", sessionInvalidated);
  } };
}
