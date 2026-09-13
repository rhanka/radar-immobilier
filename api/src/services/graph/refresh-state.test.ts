import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  completeRefreshChunk,
  openRefreshState,
  readCompletedRefreshChunk,
  reserveRefreshChunk,
  writeRefreshCandidate,
  writeRefreshStageReceipt,
  type RefreshRunIdentity,
} from "./refresh-state.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  fail: ((key: string) => boolean) | undefined;

  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
    if (this.fail?.(key)) throw new Error(`write failed: ${key}`);
    this.objects.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
    return { key };
  }

  async get(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) throw new Error(`missing ${key}`);
    return value;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    return this.objects.has(key) ? { key } : null;
  }
}

function identity(baselineHash = "sha256:" + "b".repeat(64)): RefreshRunIdentity {
  return {
    citySlug: "waterloo",
    inputHash: "sha256:" + "a".repeat(64),
    baselineHash,
    profileHash: "sha256:" + "c".repeat(64),
    registryHash: "sha256:" + "d".repeat(64),
    packageVersion: "0.18.0",
    modelPolicy: "gemini:gemini-3.8-flash",
    exclusions: ["signal:excluded"],
  };
}

describe("refresh durable state", () => {
  it("should resume a completed same-input chunk without another call", async () => {
    const store = new MemoryStore();
    let handle = await openRefreshState(store, identity(), 6);
    const reserved = await reserveRefreshChunk(store, handle, "chunk.1", 2);
    expect(reserved.shouldCall).toBe(true);
    handle = await completeRefreshChunk(store, reserved, "chunk.1", { nodes: [{ id: "signal-1" }] });

    const resumed = await openRefreshState(store, identity(), 6);
    const skipped = await reserveRefreshChunk(store, resumed, "chunk.1", 2);
    expect(skipped.shouldCall).toBe(false);
    expect(skipped.state.reservedCalls).toBe(2);
    expect(await readCompletedRefreshChunk(store, skipped, "chunk.1"))
      .toEqual({ nodes: [{ id: "signal-1" }] });
  });

  it("should reject a changed completed chunk artifact", async () => {
    const store = new MemoryStore();
    const reserved = await reserveRefreshChunk(store, await openRefreshState(store, identity(), 2), "chunk.1", 2);
    const completed = await completeRefreshChunk(store, reserved, "chunk.1", { nodes: [] });
    store.objects.set(completed.state.completedChunks["chunk.1"]!.key,
      new TextEncoder().encode('{"nodes":[{"id":"changed"}]}'));
    await expect(readCompletedRefreshChunk(store, completed, "chunk.1"))
      .rejects.toThrow("hash mismatch");
  });

  it("should count interrupted maximum-attempt reservations conservatively", async () => {
    const store = new MemoryStore();
    let handle = await openRefreshState(store, identity(), 4);
    handle = await reserveRefreshChunk(store, handle, "chunk.1", 2);
    handle = await openRefreshState(store, identity(), 4);
    handle = await reserveRefreshChunk(store, handle, "chunk.1", 2);
    expect(handle.state).toMatchObject({
      reservedCalls: 4,
      reservations: { "chunk.1": 4 },
    });
    await expect(reserveRefreshChunk(store, handle, "chunk.1", 2))
      .rejects.toThrow("budget exhausted");
  });

  it("should create a distinct durable identity when the baseline changes", async () => {
    const store = new MemoryStore();
    const first = await openRefreshState(store, identity(), 2);
    const second = await openRefreshState(store, identity("sha256:" + "f".repeat(64)), 2);
    expect(second.key).not.toBe(first.key);
    expect(second.state.reservedCalls).toBe(0);
  });

  it("should bind one deterministic immutable candidate to the run", async () => {
    const store = new MemoryStore();
    const opened = await openRefreshState(store, identity(), 2);
    const written = await writeRefreshCandidate(store, opened, { nodes: [], edges: [] });
    expect(written.state.candidate?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await writeRefreshCandidate(store, written, { edges: [], nodes: [] })).state.candidate)
      .toEqual(written.state.candidate);
    await expect(writeRefreshCandidate(store, written, { nodes: [{ id: "changed" }], edges: [] }))
      .rejects.toThrow("Non-deterministic candidate");
  });

  it("should persist redacted failure receipts and never mark a failed receipt write", async () => {
    const store = new MemoryStore();
    const opened = await openRefreshState(store, identity(), 2);
    const receipt = {
      stage: "projected" as const,
      status: "failed" as const,
      reason: "postgres-write-failed",
      recordedAt: "2026-09-13T00:00:00.000Z",
    };
    const failed = await writeRefreshStageReceipt(store, opened, receipt);
    expect(failed.state.receipts.projected).toEqual(receipt);

    const next = await openRefreshState(store, identity("sha256:" + "f".repeat(64)), 2);
    store.fail = (key) => key.endsWith("/receipts/projected.json");
    await expect(writeRefreshStageReceipt(store, next, receipt)).rejects.toThrow("write failed");
    expect(next.state.receipts.projected).toBeUndefined();
    await expect(writeRefreshStageReceipt(store, next, { ...receipt, reason: "api key leaked" }))
      .rejects.toThrow("redacted reason code");
  });
});
