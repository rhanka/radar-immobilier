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
  it("should keep an epoch across page mounts and publish coherent own records after debounce", async () => {
    vi.useFakeTimers(); const storage = memoryStorage();
    const { sync: a } = setup(storage); const { sync: b } = setup(storage);
    await a.account("subject"); const first = storage.getItem(SESSION_KEY);
    await b.account("subject"); expect(storage.getItem(SESSION_KEY)).toBe(first);
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
