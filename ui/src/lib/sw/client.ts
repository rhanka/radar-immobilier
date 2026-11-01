import { get, writable } from "svelte/store";
import { SW_SCRIPT_URL, SW_SCOPE, validateSwMessage, createClientId, type SwInvalidatePayload,
  type SwWorkerInfo } from "./protocol.js";
import { gateServiceWorkerRuntime, runtimeProbes, readClientBuildId, type SwRuntimeProbes } from "./runtime.js";
import { exchange, activated } from "./transport.js";

export type SwStatus = "unsupported" | "unavailable" | "installing" | "ready" | "waiting" | "disabled";
export function initServiceWorker(options: {
  probes?: SwRuntimeProbes; enabled?: boolean; clientBuildId?: string;
  onInvalidation?: (payload: SwInvalidatePayload) => void;
  onSessionInvalidated?: () => void;
} = {}) {
  const status = writable<SwStatus>("unsupported");
  const worker = writable<SwWorkerInfo | null>(null);
  const hello = { clientBuildId: options.clientBuildId ?? readClientBuildId(),
    tabId: createClientId(), protocolVersion: 1 };
  const cleanups: Array<() => void> = [];
  let registration: ServiceWorkerRegistration | undefined;
  let disposed = false;
  let disabled = false;
  const enabled = options.enabled ?? (typeof __IMMO_SW_ENABLED__ === "undefined" || __IMMO_SW_ENABLED__);
  const setStatus = (value: SwStatus) => { if (!disposed && (!disabled || value === "disabled")) status.set(value); };
  async function connect(target: ServiceWorker) {
    const ack = await exchange(target, "HELLO", hello);
    if (ack.type !== "HELLO_ACK" || ack.payload?.protocolVersion !== 1) throw new Error("incompatible-worker");
    if (!disposed) worker.set(ack.payload as unknown as SwWorkerInfo);
    return target;
  }
  async function refresh() {
    if (disposed || disabled) return;
    try {
      if (registration?.active) await connect(registration.active);
      setStatus(registration?.waiting ? "waiting" : registration?.active ? "ready" : "installing");
    } catch { setStatus("unavailable"); }
  }
  async function request(type: string, payload?: Record<string, unknown>) {
    if (disposed || disabled || !enabled || !registration?.active) throw new Error("worker-unavailable");
    // Repeat HELLO on each operation: a stopped worker loses its registry.
    return exchange(await connect(registration.active), type, payload);
  }
  function onMessage(event: MessageEvent) {
    const source = event.source as ServiceWorker | null;
    if (source?.scriptURL !== new URL(SW_SCRIPT_URL, window.location.origin).href
      || !validateSwMessage(event.data, "worker")) return;
    const m = event.data;
    if (m.type === "HELLO" && enabled && !disposed && !disabled) {
      event.ports[0]?.postMessage({ protocol: 1, type: "HELLO", id: crypto.randomUUID(),
        correlationId: m.id, payload: hello });
    } else if (m.type === "DISABLED") {
      disabled = true; worker.set(null); setStatus("disabled");
    } else if (enabled && !disabled && m.type === "INVALIDATE") {
      options.onInvalidation?.(m.payload as unknown as SwInvalidatePayload);
    } else if (enabled && !disabled && m.type === "SESSION_INVALIDATED") options.onSessionInvalidated?.();
  }
  function listen(target: EventTarget, type: string, handler: EventListener) {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  }
  function watchInstall() {
    const installing = registration?.installing;
    if (!installing) return;
    listen(installing, "statechange", () => { void refresh(); });
  }
  async function boot() {
    if (!gateServiceWorkerRuntime(options.probes ?? runtimeProbes())) return;
    setStatus("installing");
    listen(navigator.serviceWorker, "message", onMessage as EventListener);
    try {
      // A disabled build still updates existing registrations to the kill bytes.
      registration = enabled
        ? await navigator.serviceWorker.register(SW_SCRIPT_URL, { scope: SW_SCOPE, updateViaCache: "none" })
        : await navigator.serviceWorker.getRegistration(SW_SCOPE);
      if (disposed) return;
      if (!registration) { setStatus("disabled"); return; }
      listen(registration, "updatefound", watchInstall);
      listen(navigator.serviceWorker, "controllerchange", () => { void refresh(); });
      const resume = () => {
        if (document.visibilityState === "hidden" || disposed) return;
        void registration?.update().catch(() => undefined); void refresh();
      };
      listen(window, "pageshow", resume); listen(window, "online", resume);
      listen(window, "focus", resume); listen(document, "visibilitychange", resume);
      watchInstall();
      if (!enabled) { await registration.update(); setStatus("disabled"); return; }
      if (!registration.active && registration.installing) await activated(registration.installing);
      await refresh();
    } catch { setStatus("unavailable"); }
  }
  void boot();
  return {
    status: { subscribe: status.subscribe }, worker: { subscribe: worker.subscribe },
    async ping(): Promise<SwWorkerInfo> {
      const reply = await request("PING"); return reply.payload as unknown as SwWorkerInfo;
    },
    async notifyInvalidation(payload: SwInvalidatePayload) {
      return request("INVALIDATE", { ...payload });
    },
    async notifySessionInvalidated(payload: { partition: string; epoch: string }) {
      return request("SESSION_INVALIDATED", payload);
    },
    async checkForUpdate() { await registration?.update(); await refresh(); },
    async requestCompatibleActivation(): Promise<{ ok: boolean; reason?: string }> {
      const target = registration?.waiting;
      if (!enabled || !target || disabled) return { ok: false, reason: "no-waiting-worker" };
      try {
        await connect(target);
        const result = await exchange(target, "ACTIVATE_COMPATIBLE");
        if (result.payload?.ok !== true) return { ok: false, reason: String(result.payload?.reason) };
        await activated(target); await refresh();
        return { ok: true };
      } catch { return { ok: false, reason: "activation-unavailable" }; }
    },
    dispose() { disposed = true; cleanups.splice(0).forEach((cleanup) => cleanup()); },
  };
}
export type ServiceWorkerClient = ReturnType<typeof initServiceWorker>;
export const serviceWorkerClientStore = writable<ServiceWorkerClient | null>(null);
export const publishServiceWorkerClient = (client: ServiceWorkerClient | null) => serviceWorkerClientStore.set(client);
export const currentServiceWorkerClient = () => get(serviceWorkerClientStore);
