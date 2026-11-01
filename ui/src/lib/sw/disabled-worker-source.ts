/**
 * Kill-switch worker source for the immo UI service worker.
 *
 * Neutralization procedure: deploy the bytes returned by
 * {@link buildDisabledWorkerSource} AT the stable worker URL
 * (`/immo-sw.js`). The kill worker installs immediately, notifies the pages,
 * notifies every connected client with DISABLED, then unregisters its own
 * registration. Open pages stay usable; their next load runs without any
 * worker. Like the active worker it has no `fetch` handler, no cache and no
 * storage access.
 *
 * The source is generated (not served from `public/`) so the kill bytes
 * never ship as a secondary prod URL; ops publish them at `/immo-sw.js`
 * only. The e2e kill-switch test serves these exact bytes through HTTP
 * interception at the stable URL.
 */

export const DISABLED_WORKER_PROTOCOL_VERSION = 1;

/** Build the kill-switch worker bytes for one deployment identity. */
export function buildDisabledWorkerSource(workerBuildId: string): string {
  const buildId = JSON.stringify(workerBuildId);
  return `/**
 * Immo UI service worker — DISABLED (kill switch).
 * Notifies connected clients, then unregisters. No fetch, no cache.
 */
const WORKER_BUILD_ID = ${buildId};
const PROTOCOL_VERSION = ${DISABLED_WORKER_PROTOCOL_VERSION};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const targets = await self.clients.matchAll({ includeUncontrolled: true });
      for (const target of targets) {
        try {
          target.postMessage({
            protocol: PROTOCOL_VERSION,
            type: "DISABLED",
            id: "sw-disabled",
            payload: { workerBuildId: WORKER_BUILD_ID },
          });
        } catch {
          /* A dead client must not block the unregister. */
        }
      }
      await self.registration.unregister();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const port = event.ports && event.ports[0];
  if (!port) return;
  port.postMessage({
    protocol: PROTOCOL_VERSION,
    type: "DISABLED",
    id: "sw-disabled",
    correlationId: event.data?.id,
    payload: { workerBuildId: WORKER_BUILD_ID },
  });
});
`;
}
