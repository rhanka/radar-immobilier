/**
 * acquisition-state.test.ts — issue #805: the per-URL acquisition state keeps
 * deferred documents and open attempts apart from the known-URL guard, so a
 * document that was never collected is never recorded as collected.
 */
import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  acquisitionJournal,
  acquisitionStateKey,
  INTERRUPTED_ATTEMPTS,
  loadAcquisitionState,
  saveAcquisitionState,
} from "./acquisition-state.js";
import { collectedUrlsKey } from "./known-urls.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength };
  }
  async get(key: string): Promise<Uint8Array> {
    const v = this.objects.get(key);
    if (!v) throw new Error(`missing ${key}`);
    return v;
  }
  async head(key: string): Promise<ObjectInfo | null> {
    const v = this.objects.get(key);
    return v ? { key, size: v.byteLength } : null;
  }
}

const SOURCE = "proces-verbaux-saint-augustin-de-desmaures";
const big = "https://vsad.ca/uploads/zonage.pdf";
const killer = "https://vsad.ca/uploads/killer.pdf";
const lines = (store: MemoryStore) => new TextDecoder().decode(store.objects.get(acquisitionStateKey(SOURCE))!)
  .trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);

describe("per-URL acquisition state (#805)", () => {
  it("round-trips deferrals and open attempts in its own object, never in the known-URL guard", async () => {
    const store = new MemoryStore();
    await saveAcquisitionState(store, SOURCE, {
      deferred: new Map([[big, { reason: "deferred-oversize", markedAt: "2026-10-03T00:00:00.000Z",
        bytesAnnounced: 180_215_792, bytesRead: 0, capBytes: 52_428_800 }]]),
      attempts: new Map([[killer, { open: 1, lastAt: "2026-10-03T01:00:00.000Z" }]]),
    });
    expect(lines(store)).toEqual([
      { url: big, state: "deferred-oversize", markedAt: "2026-10-03T00:00:00.000Z",
        bytesAnnounced: 180_215_792, bytesRead: 0, capBytes: 52_428_800 },
      { url: killer, state: "attempt-open", open: 1, lastAt: "2026-10-03T01:00:00.000Z" },
    ]);
    const state = await loadAcquisitionState(store, SOURCE);
    expect(state.deferred.get(big)).toMatchObject({ reason: "deferred-oversize", bytesAnnounced: 180_215_792 });
    expect(state.attempts.get(killer)).toEqual({ open: 1, lastAt: "2026-10-03T01:00:00.000Z" });
    expect(store.objects.has(collectedUrlsKey(SOURCE))).toBe(false);
  });

  it("writes the attempt BEFORE the request and closes it on settlement", async () => {
    const store = new MemoryStore();
    const state = await loadAcquisitionState(store, SOURCE);
    const journal = acquisitionJournal(store, SOURCE, state, () => new Date("2026-10-03T02:00:00.000Z"));
    await journal.open(killer);
    // What a process killed right now leaves on storage.
    expect(lines(store)).toEqual([{ url: killer, state: "attempt-open", open: 1, lastAt: "2026-10-03T02:00:00.000Z" }]);
    journal.close(killer, "collected");
    expect(state.attempts.size).toBe(0);
    expect(journal.changed()).toBe(true);
  });

  it(`sets a document aside as interrupted-repeatedly after ${INTERRUPTED_ATTEMPTS} unclosed attempts`, async () => {
    const store = new MemoryStore();
    for (const pass of [1, 2]) {
      const journal = acquisitionJournal(store, SOURCE, await loadAcquisitionState(store, SOURCE));
      expect(journal.setAside(killer)).toBeUndefined();
      await journal.open(killer); // ...and the process never comes back: never closed.
      expect((await loadAcquisitionState(store, SOURCE)).attempts.get(killer)?.open).toBe(pass);
    }
    const state = await loadAcquisitionState(store, SOURCE);
    const journal = acquisitionJournal(store, SOURCE, state, () => new Date("2026-10-04T00:00:00.000Z"));
    expect(journal.setAside(killer)).toEqual({ url: killer, reason: "interrupted-repeatedly", newlySetAside: true,
      markedAt: "2026-10-04T00:00:00.000Z", attempts: 2 });
    await saveAcquisitionState(store, SOURCE, state);
    expect(acquisitionJournal(store, SOURCE, await loadAcquisitionState(store, SOURCE)).setAside(killer))
      .toMatchObject({ reason: "interrupted-repeatedly", newlySetAside: false, attempts: 2 });
  });

  it("tells an absent state from a store fault", async () => {
    const failing = (error: unknown): ObjectStore => ({
      get: async () => { throw error; }, head: async () => null, put: async (key) => ({ key }),
    });
    const absent = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    const fault = Object.assign(new Error("Service Unavailable"), { $metadata: { httpStatusCode: 503 } });
    expect((await loadAcquisitionState(failing(absent), SOURCE)).unreadable).toBe(false);
    expect((await loadAcquisitionState(failing(fault), SOURCE)).unreadable).toBe(true);
    expect((await loadAcquisitionState(new MemoryStore(), SOURCE)).unreadable).toBe(false);
  });

  it("records an oversize settlement as a deferral and never throws when it cannot be written", async () => {
    const readOnly: ObjectStore = {
      get: async () => { throw new Error("absent"); }, head: async () => null,
      put: async () => { throw new Error("read-only"); },
    };
    const state = await loadAcquisitionState(readOnly, SOURCE);
    const journal = acquisitionJournal(readOnly, SOURCE, state);
    await expect(journal.open(big)).resolves.toBeUndefined();
    journal.close(big, { url: big, reason: "deferred-oversize", newlySetAside: true, markedAt: "t", bytesRead: 9 });
    expect(state.attempts.size).toBe(0);
    expect(state.deferred.get(big)).toEqual({ reason: "deferred-oversize", markedAt: "t", bytesRead: 9 });
  });
});
