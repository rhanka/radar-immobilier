import { SYNC_CHANNEL } from "./preferences.js";
import { createClientId, isUuidLike } from "../sw/protocol.js";
import { CONTEXT_PREFIX, SESSION_KEY, type SessionInvalidation } from "./ui-state-contract.js";
export function browserSyncChannel(receive: (key: string | null, invalidated?: SessionInvalidation) => void) {
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(SYNC_CHANNEL); } catch { /* storage events suffice */ }
  channel?.addEventListener("message", ({ data }) => {
    if (data?.protocol === 1 && ["STATE_INVALIDATED", "SESSION_INVALIDATED"].includes(data.type)
      && typeof data.key === "string" && (data.key === SESSION_KEY || data.key.startsWith(CONTEXT_PREFIX))) {
      if (data.type === "SESSION_INVALIDATED") {
        const p = data.payload;
        if (data.key === SESSION_KEY && typeof p?.partition === "string" && /^[a-f0-9]{64}$/.test(p.partition)
          && isUuidLike(p.epoch)) receive(data.key, p);
      } else receive(data.key);
    }
  });
  const storage = (event: StorageEvent) => receive(event.key);
  window.addEventListener("storage", storage);
  return { notify(key: string, invalidated?: SessionInvalidation) { try { channel?.postMessage({ protocol: 1,
    type: invalidated ? "SESSION_INVALIDATED" : "STATE_INVALIDATED", key,
    ...(invalidated ? { payload: invalidated } : {}),
    id: createClientId() }); } catch { /* no retry loop */ } },
    dispose() { channel?.close(); window.removeEventListener("storage", storage); } };
}
