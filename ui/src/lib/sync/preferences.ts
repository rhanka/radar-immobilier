import { get, writable, type Writable } from "svelte/store";

export const PREFERENCES_SCHEMA = "immo.ui.preferences@1.0.0";
export const SYNC_CHANNEL = "immo.ui.sync.v1";
export interface ScalarCodec<T> {
  fallback: T;
  decode(raw: string | null): T | undefined;
  encode(value: T): string | null;
}
export const betaCodec: ScalarCodec<boolean> = {
  fallback: false, decode: (v) => v === null ? false : v === "true" ? true : undefined,
  encode: (v) => v ? "true" : null,
};
export const displayModeCodec: ScalarCodec<"docked" | "floating"> = {
  fallback: "docked", decode: (v) => v === null ? "docked" : v === "docked" || v === "floating" ? v : undefined,
  encode: (v) => v,
};
export const labelCodec = (fallback: boolean): ScalarCodec<boolean> => ({
  fallback, decode: (v) => v === null ? fallback : v === "1" ? true : v === "0" ? false : undefined,
  encode: (v) => v ? "1" : "0",
});
export interface PreferencePlatform {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  listen(listener: (key: string | null) => void): () => void;
  notify(key: string): void;
}

let browserPlatform: PreferencePlatform | undefined;
export function preferencePlatform(): PreferencePlatform | undefined {
  if (typeof window === "undefined") return undefined;
  if (browserPlatform) return browserPlatform;
  // Accessing localStorage itself can throw (blocked storage, embedded browser).
  let storage: Storage;
  try { storage = window.localStorage; } catch { return undefined; }
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(SYNC_CHANNEL); } catch { /* storage events suffice */ }
  const listeners = new Set<(key: string | null) => void>();
  window.addEventListener("storage", (event) => {
    if (event.storageArea && event.storageArea !== storage) return;
    listeners.forEach((listener) => listener(event.key));
  });
  channel?.addEventListener("message", ({ data }) => {
    if (data?.protocol !== 1 || data.type !== "PREFERENCE_INVALIDATED" || typeof data.key !== "string") return;
    listeners.forEach((listener) => listener(data.key));
  });
  browserPlatform = { storage, listen(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    notify(key) { try { channel?.postMessage({ protocol: 1, type: "PREFERENCE_INVALIDATED", key,
      id: crypto.randomUUID() }); } catch { /* no transport dependency */ } } };
  return browserPlatform;
}

/** Stable scalar encodings; receives only re-read, never write back. */
export function createSyncedPreference<T>(key: string, codec: ScalarCodec<T>,
  platform = preferencePlatform()): Writable<T> & { dispose(): void } {
  let storageAvailable = true;
  let unknown = false;
  const read = (): T => {
    try {
      const decoded = codec.decode(platform?.storage.getItem(key) ?? null);
      unknown = decoded === undefined;
      return decoded ?? codec.fallback;
    } catch { storageAvailable = false; return codec.fallback; }
  };
  const store = writable(read());
  const unlisten = platform?.listen((changed) => { if (changed === key || changed === null) store.set(read()); });
  const set = (value: T) => {
    store.set(value);
    if (!platform || !storageAvailable || unknown) return;
    try {
      // Re-read before writing so an older tab preserves a newly unknown encoding.
      if (codec.decode(platform.storage.getItem(key)) === undefined) { unknown = true; return; }
      const raw = codec.encode(value);
      if (raw === null) platform.storage.removeItem(key); else platform.storage.setItem(key, raw);
      platform.notify(key);
    } catch { storageAvailable = false; }
  };
  return { subscribe: store.subscribe, set, update: (fn) => set(fn(get(store))),
    dispose: () => unlisten?.() };
}

export const chatDisplayMode = createSyncedPreference("chatWidgetDisplayMode", displayModeCodec);
export const lotLabels = createSyncedPreference("signaux-show-lot-labels", labelCodec(false));
export const zoneLabels = createSyncedPreference("signaux-show-zone-labels", labelCodec(true));
