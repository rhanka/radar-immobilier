import { CONTEXT_PREFIX } from "./ui-state-contract.js";
/** A failed browser storage operation disables writes for this page instance. */
export function contextStorage(storage: Storage | null, notify?: (key: string) => void) {
  let available = storage !== null;
  const read = (key: string) => {
    try { return storage?.getItem(key) ?? null; } catch { available = false; return null; }
  };
  const write = (key: string, value: string) => {
    if (!available) return false;
    try { storage!.setItem(key, value); notify?.(key); return true; }
    catch { available = false; return false; }
  };
  const keys = (): string[] => {
    try { return Array.from({ length: storage?.length ?? 0 }, (_, i) => storage!.key(i)!)
      .filter((key) => key?.startsWith(CONTEXT_PREFIX)); }
    catch { available = false; return []; }
  };
  const remove = (key: string) => {
    try { storage?.removeItem(key); return true; } catch { available = false; return false; }
  };
  const purge = (partition: string) => {
    for (const key of keys()) if (key.startsWith(`${CONTEXT_PREFIX}${partition}.`) && !remove(key)) return;
  };
  return { read, write, keys, remove, purge, get available() { return available; } };
}
