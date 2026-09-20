/**
 * known-urls.test.ts — the cheap half of the owner's 24 h rule (issue #723):
 * read every city's index on every run (the CHECK), but do not download again a
 * document the previous run already collected.
 */
import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { knownSourceUrlsFromLastRun, runsPrefix } from "./known-urls.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
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
  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}

const SOURCE = "proces-verbaux-drummondville";

function manifest(urls: readonly string[]): string {
  return urls
    .map((sourceUrl, i) =>
      JSON.stringify({ sha256: `${i}`.repeat(64).slice(0, 64), sourceUrl, casKey: `cas/${i}`, status: "new" }))
    .join("\n") + "\n";
}

describe("knownSourceUrlsFromLastRun", () => {
  it("reads the URLs of the LAST run, not of an earlier one", async () => {
    const store = new MemoryStore();
    // Run ids are ISO-derived, so lexicographic order is chronological order.
    await store.put(
      `${runsPrefix(SOURCE)}2026-09-18T000000000Z-r/manifest.jsonl`,
      manifest(["https://v.qc.ca/a.pdf"]),
    );
    await store.put(
      `${runsPrefix(SOURCE)}2026-09-19T000000000Z-r/manifest.jsonl`,
      manifest(["https://v.qc.ca/a.pdf", "https://v.qc.ca/b.pdf"]),
    );
    const urls = await knownSourceUrlsFromLastRun(store, SOURCE);
    expect([...urls].sort()).toEqual(["https://v.qc.ca/a.pdf", "https://v.qc.ca/b.pdf"]);
  });

  it("knows nothing about a source that has never run — so everything gets fetched", async () => {
    const urls = await knownSourceUrlsFromLastRun(new MemoryStore(), SOURCE);
    expect(urls.size).toBe(0);
  });

  it("degrades to 'nothing known' when the store cannot list", async () => {
    const backing = new MemoryStore();
    const key = `${runsPrefix(SOURCE)}2026-09-19T000000000Z-r/manifest.jsonl`;
    await backing.put(key, manifest(["https://v.qc.ca/a.pdf"]));
    // `list` is optional on ObjectStore: in-memory doubles often omit it.
    const noList: ObjectStore = {
      get: (k) => backing.get(k),
      head: (k) => backing.head(k),
      put: (k, b) => backing.put(k, b),
    };
    expect((await knownSourceUrlsFromLastRun(noList, SOURCE)).size).toBe(0);
  });

  it("skips a malformed line instead of losing the whole set", async () => {
    const store = new MemoryStore();
    await store.put(
      `${runsPrefix(SOURCE)}2026-09-19T000000000Z-r/manifest.jsonl`,
      `{ not json\n${manifest(["https://v.qc.ca/a.pdf"])}`,
    );
    expect([...(await knownSourceUrlsFromLastRun(store, SOURCE))])
      .toEqual(["https://v.qc.ca/a.pdf"]);
  });

  it("never throws on an unreadable manifest — a missing history must mean 'fetch it'", async () => {
    const backing = new MemoryStore();
    const key = `${runsPrefix(SOURCE)}2026-09-19T000000000Z-r/manifest.jsonl`;
    const broken: ObjectStore = {
      get: async () => { throw new Error("S3 unavailable"); },
      head: (k) => backing.head(k),
      put: (k, b) => backing.put(k, b),
      list: async () => [key],
    };
    expect((await knownSourceUrlsFromLastRun(broken, SOURCE)).size).toBe(0);
  });

  it("does not confuse two sources", async () => {
    const store = new MemoryStore();
    await store.put(
      `${runsPrefix("proces-verbaux-other")}2026-09-19T000000000Z-r/manifest.jsonl`,
      manifest(["https://other.qc.ca/a.pdf"]),
    );
    expect((await knownSourceUrlsFromLastRun(store, SOURCE)).size).toBe(0);
  });
});
