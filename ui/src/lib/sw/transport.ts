import { SW_HANDSHAKE_TIMEOUT_MS, validateSwMessage, type SwMessage } from "./protocol.js";

export function exchange(target: ServiceWorker, type: string,
  payload?: Record<string, unknown>): Promise<SwMessage> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const id = crypto.randomUUID();
    const finish = (error: Error | null, message?: SwMessage) => {
      clearTimeout(timer); channel.port1.close();
      if (error) reject(error); else resolve(message!);
    };
    const timer = setTimeout(() => finish(new Error("worker-unreachable")), SW_HANDSHAKE_TIMEOUT_MS);
    channel.port1.onmessage = ({ data }) => {
      if (!validateSwMessage(data, "worker") || data.correlationId !== id) return;
      if (data.type === "ERROR" || data.type === "DISABLED") finish(new Error(data.type));
      else finish(null, data);
    };
    try { target.postMessage({ protocol: 1, type, id, ...(payload ? { payload } : {}) }, [channel.port2]); }
    catch { finish(new Error("worker-unreachable")); }
  });
}

/** Wait for this worker's lifecycle event, never for navigator.serviceWorker.ready
 * (the initial page intentionally has no controller). */
export function activated(worker: ServiceWorker): Promise<void> {
  if (worker.state === "activated") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const change = () => {
      if (worker.state !== "activated" && worker.state !== "redundant") return;
      worker.removeEventListener("statechange", change);
      if (worker.state === "activated") resolve(); else reject(new Error("worker-redundant"));
    };
    worker.addEventListener("statechange", change);
    change();
  });
}
