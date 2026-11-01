import { SYNC_CHANNEL } from "./preferences.js";
import { createClientId } from "../sw/protocol.js";
import { CONTEXT_PREFIX, SESSION_KEY } from "./ui-state-contract.js";
export function browserSyncChannel(receive: (key: string | null) => void) {
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(SYNC_CHANNEL); } catch { /* storage events suffice */ }
  channel?.addEventListener("message", ({ data }) => {
    if (data?.protocol === 1 && data.type === "STATE_INVALIDATED" && typeof data.key === "string"
      && (data.key === SESSION_KEY || data.key.startsWith(CONTEXT_PREFIX))) receive(data.key);
  });
  const storage = (event: StorageEvent) => receive(event.key);
  window.addEventListener("storage", storage);
  return { notify(key: string) { try { channel?.postMessage({ protocol: 1, type: "STATE_INVALIDATED", key,
    id: createClientId() }); } catch { /* no retry loop */ } },
    dispose() { channel?.close(); window.removeEventListener("storage", storage); } };
}
