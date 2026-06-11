/**
 * store.test.ts — scrape-status persistence is SHARDED per (city × source).
 *
 * Bug fixed (spec §7 #2): the old store kept ALL records in one global object
 * `scrape-status/index.json` and did read→modify→write, losing updates under
 * concurrency at 1000 cities. Each record now lives at its own key
 * `state/{citySlug}/{source}.json` (one writer per key) — spec §1.4.
 */
import { describe, expect, it } from "vitest";

import type { ScrapeStatusSourceT } from "@radar/domain";
import type {
  ObjectInfo,
  ObjectStore,
} from "../../storage/object-store.js";
import { readAll, upsert, markAsGraphified } from "./store.js";

/** In-memory ObjectStore with prefix listing (needed for the sharded aggregate). */
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
  keys(): string[] {
    return [...this.objects.keys()];
  }
}

const rec = (
  citySlug: string,
  source: ScrapeStatusSourceT,
  status = "scraped",
) => ({
  citySlug,
  source,
  automation: "refresh" as const,
  windowMonths: 6,
  status: status as "scraped" | "graphified" | "identified" | "todo",
});

describe("scrape-status store — sharded per city×source", () => {
  it("upsert writes to state/{city}/{source}.json, NOT the global index", async () => {
    const store = new MemoryStore();
    await upsert(store, rec("beloeil", "conseils-municipaux"));
    expect(store.keys()).toContain("state/beloeil/conseils-municipaux.json");
    expect(store.keys()).not.toContain("scrape-status/index.json");
  });

  it("upserts to different cities never clobber each other", async () => {
    const store = new MemoryStore();
    await upsert(store, rec("beloeil", "conseils-municipaux"));
    await upsert(store, rec("delson", "conseils-municipaux"));
    const all = await readAll(store);
    const slugs = all.map((r) => r.citySlug).sort();
    expect(slugs).toEqual(["beloeil", "delson"]);
    // each lives at its own key (the race-fix invariant)
    expect(store.keys()).toContain("state/beloeil/conseils-municipaux.json");
    expect(store.keys()).toContain("state/delson/conseils-municipaux.json");
  });

  it("readAll on an empty store returns []", async () => {
    expect(await readAll(new MemoryStore())).toEqual([]);
  });

  it("markAsGraphified updates only its own shard", async () => {
    const store = new MemoryStore();
    await upsert(store, rec("delson", "conseils-municipaux", "scraped"));
    await markAsGraphified(store, "beloeil", "conseils-municipaux");
    const all = await readAll(store);
    const beloeil = all.find((r) => r.citySlug === "beloeil");
    const delson = all.find((r) => r.citySlug === "delson");
    expect(beloeil?.status).toBe("graphified");
    expect(delson?.status).toBe("scraped"); // untouched
  });
});
