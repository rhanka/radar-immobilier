/** Dedicated qualification entrypoint; never part of Vite's production inputs. */
import { initServiceWorker } from "../src/lib/sw/client.js";
import { chatDisplayMode, lotLabels, zoneLabels, createSyncedPreference, betaCodec } from "../src/lib/sync/preferences.js";
import { get } from "svelte/store";
const beta = createSyncedPreference("radar.beta.evaluation", betaCodec);
const preferences = { beta, chat: chatDisplayMode, lots: lotLabels, zones: zoneLabels };
const params = new URLSearchParams(location.search);
let invalidations = 0;
const client = initServiceWorker({ probes: { productionBuild: true, secureContext: true,
  workerApi: true, origin: "https://preprod.immo.sent-tech.ca" },
  enabled: params.get("enabled") !== "false", clientBuildId: params.get("build") ?? "N",
  onInvalidation: () => { document.getElementById("invalidations")!.textContent = String(++invalidations); },
});
client.status.subscribe((status) => { document.getElementById("status")!.textContent = status; });
for (const [key, store] of Object.entries(preferences)) {
  store.subscribe((value) => { document.getElementById(key)!.textContent = String(value); });
}
document.getElementById("toggle-beta")!.onclick = () => beta.update((v) => !v);
document.getElementById("toggle-lots")!.onclick = () => lotLabels.update((v) => !v);
document.getElementById("toggle-zones")!.onclick = () => zoneLabels.update((v) => !v);
document.getElementById("toggle-chat")!.onclick = () => chatDisplayMode.set(get(chatDisplayMode) === "floating" ? "docked" : "floating");
declare global { interface Window { continuity: { client: ReturnType<typeof initServiceWorker> } } }
window.continuity = { client };
