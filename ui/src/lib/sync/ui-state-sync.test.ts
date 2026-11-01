import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiStateSync } from "./ui-state-sync.js";
import { contextKey, SESSION_KEY, MAX_CONTEXTS, type UiContext, type SyncDependencies } from "./ui-state-contract.js";
import { context, memoryStorage, partition, uuid, workspaceId } from "./test-support.js";
import { decodeSession } from "./ui-state-codecs.js";
const opened: ReturnType<typeof createUiStateSync>[] = [];
afterEach(() => { opened.splice(0).forEach((sync) => sync.dispose()); vi.useRealTimers(); });
function setup(storage = memoryStorage(), changes: Partial<SyncDependencies> = {}) {
  const apply = vi.fn(); const revalidate = vi.fn(); const validateWorkspace = vi.fn(async () => true);
  const sync = createUiStateSync({ storage, origin: "https://preprod.immo.sent-tech.ca", now: () => 1000, uuid,
    partition: async () => partition, snapshot: () => ({ workspaceId, payload: context().payload }),
    apply, revalidate, validateWorkspace, ...changes });
  opened.push(sync); return { sync, storage, apply, revalidate, validateWorkspace };
}
function publishPeer(storage: Storage, changes: Partial<UiContext> = {}) {
  const session = decodeSession(storage.getItem(SESSION_KEY)!)!;
  const value = { ...context(), sessionEpoch: session.sessionEpoch, ...changes };
  storage.setItem(contextKey(value), JSON.stringify(value)); return value;
}
describe("per-tab contexts and session continuity", () => {
  it("should invalidate and purge on logout while wake authentication is pending", async () => {
    const { sync, storage } = setup(); await sync.account("subject");
    const peer = publishPeer(storage);
    sync.wake(); sync.invalidate();
    expect(decodeSession(storage.getItem(SESSION_KEY)!)?.invalidated).toBe(true);
    expect(storage.getItem(contextKey(peer))).toBeNull();
    await sync.account("subject"); sync.flush(); expect(get(sync.peers)).toEqual([]);
  });
  it("should preserve a newer canonical epoch when a suspended old tab logs out", async () => {
    const { sync, storage } = setup(); await sync.account("subject");
    sync.wake();
    const next = JSON.stringify({ ...decodeSession(storage.getItem(SESSION_KEY)!)!, sessionEpoch: uuid() });
    storage.setItem(SESSION_KEY, next); sync.invalidate();
    expect(storage.getItem(SESSION_KEY)).toBe(next);
  });
  it("should preserve a fresh login when an old session invalidation arrives late", async () => {
    const { sync, storage, revalidate } = setup(); await sync.account("subject");
    const old = decodeSession(storage.getItem(SESSION_KEY)!)!;
    const next = { ...old, sessionEpoch: uuid() };
    storage.setItem(SESSION_KEY, JSON.stringify(next));
    const fresh = publishPeer(storage);
    sync.receive(SESSION_KEY); expect(storage.getItem(contextKey(fresh))).not.toBeNull();
    await sync.account("subject"); revalidate.mockClear();
    sync.sessionInvalidated({ partition: old.partition, epoch: old.sessionEpoch });
    sync.refresh(); expect(get(sync.peers)).toEqual([fresh]); expect(revalidate).not.toHaveBeenCalled();
  });
  it("should interrupt peers after quota failure and preserve unknown session bytes on logout", async () => {
    const notify = vi.fn(); const storage = memoryStorage();
    const { sync } = setup(storage, { notify }); await sync.account("subject");
    const { sync: peer } = setup(storage); await peer.account("subject");
    vi.mocked(storage.setItem).mockImplementation(() => { throw new Error("quota"); });
    const current = decodeSession(storage.getItem(SESSION_KEY)!)!;
    const hint = { partition: current.partition, epoch: current.sessionEpoch };
    sync.invalidate(); expect(notify).toHaveBeenCalledWith(SESSION_KEY, hint);
    peer.sessionInvalidated(hint); await peer.account("subject"); peer.flush();
    expect(get(peer.peers)).toEqual([]);
    const other = setup(); await other.sync.account("subject");
    other.storage.setItem(SESSION_KEY, '{"schemaVersion":"2.0.0"}'); other.sync.invalidate();
    expect(other.storage.getItem(SESSION_KEY)).toBe('{"schemaVersion":"2.0.0"}');
  });
  it("should pause publications on wake without invalidating an unchanged visible session", async () => {
    const { sync, revalidate } = setup(); await sync.account("subject");
    sync.wake(); expect(revalidate).toHaveBeenCalledWith(false);
  });
  it("should refuse a pending partition calculation when another account changes the epoch", async () => {
    let finish!: (value: string) => void;
    const { sync, storage, revalidate } = setup(memoryStorage(), {
      partition: () => new Promise((resolve) => { finish = resolve; }),
    });
    const pending = sync.account("old-account");
    const raw = JSON.stringify({ schema: "immo.ui.session", schemaVersion: "1.0.0",
      partition: "b".repeat(64), sessionEpoch: uuid(), invalidated: false });
    storage.setItem(SESSION_KEY, raw); finish(partition); await pending;
    sync.flush(); expect(storage.getItem(SESSION_KEY)).toBe(raw); expect(revalidate).toHaveBeenCalledOnce();
  });
  it("should keep an epoch across page mounts and publish coherent own records after debounce", async () => {
    vi.useFakeTimers(); const storage = memoryStorage();
    const { sync: a } = setup(storage); const { sync: b } = setup(storage);
    await a.account("subject"); const first = storage.getItem(SESSION_KEY);
    await b.account("subject"); expect(storage.getItem(SESSION_KEY)).toBe(first);
    expect(storage.setItem).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(250);
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter((k) => k !== SESSION_KEY);
    expect(keys).toHaveLength(2); expect(keys[0]).not.toBe(keys[1]);
    b.refresh(); expect(get(b.peers)).toHaveLength(1);
  });
  it("should offer a peer without navigation and adopt only after fresh workspace authorization", async () => {
    const { sync, storage, apply, validateWorkspace } = setup(); await sync.account("subject");
    const peer = publishPeer(storage); sync.receive(contextKey(peer));
    expect(get(sync.peers)).toEqual([peer]); expect(apply).not.toHaveBeenCalled();
    expect(await sync.adopt(peer)).toBe(true); expect(validateWorkspace).toHaveBeenCalledWith(workspaceId, "subject");
    expect(apply).toHaveBeenCalledWith(workspaceId, peer.payload);
    validateWorkspace.mockResolvedValue(false); expect(await sync.adopt(peer)).toBe(false);
    expect(apply).toHaveBeenCalledOnce();
  });
  it("should invalidate before purging and refuse a late adoption or auth result", async () => {
    let authorize!: (value: boolean) => void;
    const { sync, storage, apply } = setup(memoryStorage(), {
      validateWorkspace: () => new Promise((resolve) => { authorize = resolve; }),
    });
    await sync.account("subject"); const peer = publishPeer(storage); const adoption = sync.adopt(peer);
    sync.invalidate(); authorize(true); expect(await adoption).toBe(false);
    expect(apply).not.toHaveBeenCalled(); expect(storage.getItem(contextKey(peer))).toBeNull();
    expect(decodeSession(storage.getItem(SESSION_KEY)!)?.invalidated).toBe(true);
    await sync.account("subject"); sync.flush(); expect(get(sync.peers)).toEqual([]);
  });
  it("should suspend a sleeping tab on epoch changes and revalidate independently", async () => {
    const { sync, storage, revalidate } = setup(); await sync.account("subject");
    const peer = publishPeer(storage); sync.refresh(); expect(get(sync.peers)).toHaveLength(1);
    const current = decodeSession(storage.getItem(SESSION_KEY)!)!;
    storage.setItem(SESSION_KEY, JSON.stringify({ ...current, invalidated: true, sessionEpoch: uuid() }));
    sync.receive(SESSION_KEY); expect(get(sync.peers)).toEqual([]); expect(revalidate).toHaveBeenCalledOnce();
    expect(await sync.adopt(peer)).toBe(false);
  });
  it("should preserve unknown schema bytes during reads, writes and bounded retention", async () => {
    const { sync, storage } = setup(); await sync.account("subject");
    const peer = publishPeer(storage); const key = contextKey(peer);
    const raw = JSON.stringify({ ...peer, schemaVersion: "2.0.0" }); storage.setItem(key, raw);
    for (let i = 0; i < MAX_CONTEXTS + 2; i++) publishPeer(storage);
    sync.refresh(); sync.flush(); expect(storage.getItem(key)).toBe(raw);
    expect(storage.length).toBeLessThanOrEqual(MAX_CONTEXTS + 1);
  });
  it("should not overwrite an unknown session or retry a refused storage write", async () => {
    const storage = memoryStorage(); storage.setItem(SESSION_KEY, '{"schemaVersion":"2"}');
    const { sync } = setup(storage); await sync.account("subject"); sync.flush();
    expect(storage.getItem(SESSION_KEY)).toBe('{"schemaVersion":"2"}');
    const denied = memoryStorage(); vi.mocked(denied.setItem).mockImplementation(() => { throw new Error("denied"); });
    const { sync: other } = setup(denied); await other.account("subject"); other.flush(); other.flush();
    expect(denied.setItem).toHaveBeenCalledOnce();
  });
});
