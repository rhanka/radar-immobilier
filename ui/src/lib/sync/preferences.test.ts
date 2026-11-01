import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { betaCodec, displayModeCodec, labelCodec, createSyncedPreference,
  type PreferencePlatform } from "./preferences.js";
import { memoryStorage } from "./test-support.js";

describe("stable preference adapters", () => {
  it("should keep defaults and local commands when browser storage reads are refused", () => {
    const storage = memoryStorage(); vi.mocked(storage.getItem).mockImplementation(() => { throw new Error("blocked"); });
    const store = createSyncedPreference("beta", betaCodec, { storage, listen: () => () => {}, notify: vi.fn() });
    expect(get(store)).toBe(false); store.set(true); expect(get(store)).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it("should preserve the four legacy scalar encodings without a migration", () => {
    expect(betaCodec.encode(true)).toBe("true"); expect(betaCodec.encode(false)).toBeNull();
    expect(displayModeCodec.decode("floating")).toBe("floating");
    expect(displayModeCodec.decode(null)).toBe("docked");
    expect(labelCodec(false).decode(null)).toBe(false); expect(labelCodec(true).decode(null)).toBe(true);
    expect(labelCodec(false).encode(true)).toBe("1"); expect(labelCodec(true).encode(false)).toBe("0");
  });
  it("should re-read canonical keys in two tabs without an echo or lost independent writes", () => {
    const storage = memoryStorage();
    const receivers: Array<(key: string | null) => void> = [];
    const platform: PreferencePlatform = { storage, listen(fn) { receivers.push(fn); return () => {}; },
      notify(key) { receivers.forEach((fn) => fn(key)); } };
    const a = createSyncedPreference("beta", betaCodec, platform);
    const b = createSyncedPreference("beta", betaCodec, platform);
    const labels = createSyncedPreference("labels", labelCodec(true), platform);
    a.set(true); labels.set(false);
    expect(get(a)).toBe(true); expect(get(b)).toBe(true); expect(get(labels)).toBe(false);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    storage.removeItem("beta"); receivers.forEach((fn) => fn("beta"));
    expect(get(a)).toBe(false); expect(get(b)).toBe(false);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    [a, b, labels].forEach((store) => store.dispose());
  });
  it("should ignore and preserve an unknown scalar encoding even on a local command", () => {
    const storage = memoryStorage(); storage.setItem("beta", "v2:enabled");
    const store = createSyncedPreference("beta", betaCodec, { storage, listen: () => () => {}, notify: vi.fn() });
    expect(get(store)).toBe(false); store.set(true); expect(get(store)).toBe(true);
    expect(storage.getItem("beta")).toBe("v2:enabled");
  });
  it("should remain usable in memory after a quota failure without retrying", () => {
    const storage = memoryStorage(); vi.mocked(storage.setItem).mockImplementation(() => { throw new Error("quota"); });
    const notify = vi.fn();
    const store = createSyncedPreference("beta", betaCodec, { storage, listen: () => () => {}, notify });
    store.set(true); store.set(false); store.set(true);
    expect(get(store)).toBe(true); expect(storage.setItem).toHaveBeenCalledTimes(1); expect(notify).not.toHaveBeenCalled();
  });
});
