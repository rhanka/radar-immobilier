/**
 * known-urls.test.ts — the cheap half of the owner's 24 h rule (issue #723):
 * read every city's index on every run (the CHECK), but do not download again a
 * document an earlier run already collected.
 *
 * The guard's memory is CUMULATIVE and lives in one object per source. The
 * version this replaces read the previous run's MANIFEST, which lists only what
 * that run collected — so a quiet night wrote an empty one and the night after
 * re-downloaded everything. The monotonicity asserted here is what makes that
 * impossible; the four-night scenario is in `live-scrape.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  bootstrapFromRunManifests,
  collectedUrlsKey,
  loadCollectedUrls,
  MAX_COLLECTED_URLS,
  runsPrefix,
  saveCollectedUrls,
} from "./known-urls.js";

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

describe("loadCollectedUrls / saveCollectedUrls — the cumulative guard state", () => {
  it("round-trips a set through the state object", async () => {
    const store = new MemoryStore();
    await saveCollectedUrls(store, SOURCE, new Set(["https://v.qc.ca/a.pdf", "https://v.qc.ca/b.pdf"]));
    const state = await loadCollectedUrls(store, SOURCE);
    expect(state.fromState).toBe(true);
    expect([...state.urls].sort()).toEqual(["https://v.qc.ca/a.pdf", "https://v.qc.ca/b.pdf"]);
  });

  // THE property. A run that collects nothing writes back what it read; the
  // memory can only grow. Losing this is the defect both reviews of PR #735
  // found, and it costs a full re-download of every city, every other night.
  it("never shrinks: a run that adds nothing writes back the same set", async () => {
    const store = new MemoryStore();
    const known = new Set(["https://v.qc.ca/a.pdf", "https://v.qc.ca/b.pdf"]);
    await saveCollectedUrls(store, SOURCE, known);

    const quietNight = await loadCollectedUrls(store, SOURCE);
    // Nothing collected ⇒ nothing added.
    await saveCollectedUrls(store, SOURCE, quietNight.urls);

    const nightAfter = await loadCollectedUrls(store, SOURCE);
    expect([...nightAfter.urls].sort()).toEqual([...known].sort());
  });

  it("keeps first-seen order and adds the new URL at the end", async () => {
    const store = new MemoryStore();
    await saveCollectedUrls(store, SOURCE, new Set(["https://v.qc.ca/a.pdf"]));
    const state = await loadCollectedUrls(store, SOURCE);
    state.urls.add("https://v.qc.ca/b.pdf");
    await saveCollectedUrls(store, SOURCE, state.urls);
    expect([...(await loadCollectedUrls(store, SOURCE)).urls])
      .toEqual(["https://v.qc.ca/a.pdf", "https://v.qc.ca/b.pdf"]);
  });

  it("knows nothing about a source that has never run — so everything gets fetched", async () => {
    const state = await loadCollectedUrls(new MemoryStore(), SOURCE);
    expect(state.urls.size).toBe(0);
    // `fromState: false` makes the caller persist the (bootstrapped) set once
    // instead of redoing the manifest scan every night.
    expect(state.fromState).toBe(false);
  });

  it("skips a malformed line instead of losing the whole set", async () => {
    const store = new MemoryStore();
    await store.put(
      collectedUrlsKey(SOURCE),
      `{ not json\n${JSON.stringify({ url: "https://v.qc.ca/a.pdf" })}\n`,
    );
    expect([...(await loadCollectedUrls(store, SOURCE)).urls]).toEqual(["https://v.qc.ca/a.pdf"]);
  });

  it("never throws on an unreadable state — a missing history must mean 'fetch it'", async () => {
    const backing = new MemoryStore();
    const broken: ObjectStore = {
      get: async () => { throw new Error("S3 unavailable"); },
      head: (k) => backing.head(k),
      put: (k, b) => backing.put(k, b),
    };
    expect((await loadCollectedUrls(broken, SOURCE)).urls.size).toBe(0);
  });

  it("never throws when the state cannot be written — the cost is a re-download", async () => {
    const backing = new MemoryStore();
    const readOnly: ObjectStore = {
      get: (k) => backing.get(k),
      head: (k) => backing.head(k),
      put: async () => { throw new Error("S3 unavailable"); },
    };
    expect(await saveCollectedUrls(readOnly, SOURCE, new Set(["https://v.qc.ca/a.pdf"]))).toBe(false);
  });

  it("caps the state, dropping the OLDEST urls — at worst one re-download", async () => {
    const store = new MemoryStore();
    const many = new Set(
      Array.from({ length: MAX_COLLECTED_URLS + 2 }, (_, i) => `https://v.qc.ca/${i}.pdf`),
    );
    await saveCollectedUrls(store, SOURCE, many);
    const kept = (await loadCollectedUrls(store, SOURCE)).urls;
    expect(kept.size).toBe(MAX_COLLECTED_URLS);
    expect(kept.has("https://v.qc.ca/0.pdf")).toBe(false);
    expect(kept.has(`https://v.qc.ca/${MAX_COLLECTED_URLS + 1}.pdf`)).toBe(true);
  });

  it("does not confuse two sources", async () => {
    const store = new MemoryStore();
    await saveCollectedUrls(store, "proces-verbaux-other", new Set(["https://other.qc.ca/a.pdf"]));
    expect((await loadCollectedUrls(store, SOURCE)).urls.size).toBe(0);
  });
});

describe("bootstrapFromRunManifests — one-off seed for a source collected before the state existed", () => {
  it("unions the past manifests so upgrading does not re-download the back catalogue", async () => {
    const store = new MemoryStore();
    // Run ids are ISO-derived, so lexicographic order is chronological order.
    await store.put(
      `${runsPrefix(SOURCE)}2026-09-18T000000000Z-r/manifest.jsonl`,
      manifest(["https://v.qc.ca/a.pdf"]),
    );
    // A quiet night: an EMPTY manifest, which is exactly what used to make the
    // guard forget everything.
    await store.put(`${runsPrefix(SOURCE)}2026-09-19T000000000Z-r/manifest.jsonl`, "");
    await store.put(
      `${runsPrefix(SOURCE)}2026-09-20T000000000Z-r/manifest.jsonl`,
      manifest(["https://v.qc.ca/b.pdf"]),
    );
    const state = await loadCollectedUrls(store, SOURCE);
    expect([...state.urls].sort()).toEqual(["https://v.qc.ca/a.pdf", "https://v.qc.ca/b.pdf"]);
    expect(state.fromState).toBe(false);
  });

  it("degrades to 'nothing known' when the store cannot list", async () => {
    const backing = new MemoryStore();
    await backing.put(
      `${runsPrefix(SOURCE)}2026-09-19T000000000Z-r/manifest.jsonl`,
      manifest(["https://v.qc.ca/a.pdf"]),
    );
    // `list` is optional on ObjectStore: in-memory doubles often omit it.
    const noList: ObjectStore = {
      get: (k) => backing.get(k),
      head: (k) => backing.head(k),
      put: (k, b) => backing.put(k, b),
    };
    expect((await bootstrapFromRunManifests(noList, SOURCE)).size).toBe(0);
  });

  it("never throws on an unreadable manifest", async () => {
    const backing = new MemoryStore();
    const key = `${runsPrefix(SOURCE)}2026-09-19T000000000Z-r/manifest.jsonl`;
    const broken: ObjectStore = {
      get: async () => { throw new Error("S3 unavailable"); },
      head: (k) => backing.head(k),
      put: (k, b) => backing.put(k, b),
      list: async () => [key],
    };
    expect((await bootstrapFromRunManifests(broken, SOURCE)).size).toBe(0);
  });

  it("ignores the state object itself when scanning manifests", async () => {
    const store = new MemoryStore();
    await store.put(collectedUrlsKey(SOURCE), JSON.stringify({ url: "https://v.qc.ca/state.pdf" }));
    await store.put(
      `${runsPrefix(SOURCE)}2026-09-19T000000000Z-r/manifest.jsonl`,
      manifest(["https://v.qc.ca/a.pdf"]),
    );
    expect([...(await bootstrapFromRunManifests(store, SOURCE))]).toEqual(["https://v.qc.ca/a.pdf"]);
  });
});
