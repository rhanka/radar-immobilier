import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sourcesRoute } from "./sources.js";
import type { ObjectInfo, ObjectStore } from "../storage/object-store.js";
import {
  AVIS_PUBLICS_FIXTURE_HTML,
  ROLE_EVALUATION_MAMH_VALLEYFIELD_XML,
} from "@radar/sources";

/** In-memory ObjectStore so the RECUEIL route is testable without MinIO. */
class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  putCalls = 0;

  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    _contentType?: string,
  ): Promise<ObjectInfo> {
    this.putCalls += 1;
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
}

describe("POST /api/sources/collect/:source (RECUEIL)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns 404 for an unknown source", async () => {
    const store = new MemoryStore();
    const app = sourcesRoute({ store });
    const res = await app.request("/api/sources/collect/nope", { method: "POST" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("unknown-source");
  });

  describe("avis-publics-valleyfield (fetch stubbed)", () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(AVIS_PUBLICS_FIXTURE_HTML, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ) as unknown as typeof fetch;
    });

    it("stores the raw payload and returns rawDocIds + count", async () => {
      const store = new MemoryStore();
      const app = sourcesRoute({ store });
      const res = await app.request("/api/sources/collect/avis-publics-valleyfield", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        source: string;
        count: number;
        rawDocIds: string[];
        fetchedAt: string;
      };
      expect(body.ok).toBe(true);
      expect(body.source).toBe("avis-publics-valleyfield");
      expect(body.count).toBe(1);
      expect(body.rawDocIds[0]).toMatch(/^raw:avis-publics-valleyfield:[a-f0-9]{64}$/);
      expect(body.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // The raw bytes were stored under the canonical key before any extraction.
      const keys = [...store.objects.keys()];
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(
        /^raw\/avis-publics-valleyfield\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9]{64}\.html$/,
      );
    });

    it("is idempotent: a second collection re-uses the stored object", async () => {
      const store = new MemoryStore();
      const app = sourcesRoute({ store });
      await app.request("/api/sources/collect/avis-publics-valleyfield", { method: "POST" });
      await app.request("/api/sources/collect/avis-publics-valleyfield", { method: "POST" });
      // Same sha → one object, and the second run skipped the put().
      expect(store.objects.size).toBe(1);
      expect(store.putCalls).toBe(1);
    });
  });

  describe("role-evaluation-mamh-70052 (fetch stubbed with REAL committed bytes)", () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(ROLE_EVALUATION_MAMH_VALLEYFIELD_XML, {
            status: 200,
            headers: { "content-type": "application/xml; charset=utf-8" },
          }),
      ) as unknown as typeof fetch;
    });

    it("collects the rôle XML into S3 under the canonical raw key", async () => {
      const store = new MemoryStore();
      const app = sourcesRoute({ store });
      const res = await app.request("/api/sources/collect/role-evaluation-mamh-70052", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        source: string;
        count: number;
        rawDocIds: string[];
      };
      expect(body.ok).toBe(true);
      expect(body.source).toBe("role-evaluation-mamh-70052");
      expect(body.count).toBe(1);
      expect(body.rawDocIds[0]).toMatch(/^raw:role-evaluation-mamh-70052:[a-f0-9]{64}$/);
      const keys = [...store.objects.keys()];
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(
        /^raw\/role-evaluation-mamh-70052\/\d{4}\/\d{2}\/\d{2}\/[a-f0-9]{64}\.xml$/,
      );
    });

    it("is idempotent: a second collection re-uses the stored rôle object", async () => {
      const store = new MemoryStore();
      const app = sourcesRoute({ store });
      await app.request("/api/sources/collect/role-evaluation-mamh-70052", { method: "POST" });
      await app.request("/api/sources/collect/role-evaluation-mamh-70052", { method: "POST" });
      expect(store.objects.size).toBe(1);
      expect(store.putCalls).toBe(1);
    });

    it("collect-and-exploit yields REAL Lot/Valuation mentions from the rôle bytes", async () => {
      const store = new MemoryStore();
      const app = sourcesRoute({ store });
      const res = await app.request(
        "/api/sources/collect-and-exploit/role-evaluation-mamh-70052",
        { method: "POST" },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        citySlug: string;
        mentionCount: number;
        canonicalCount: number;
        stateKey: string;
      };
      expect(body.ok).toBe(true);
      expect(body.citySlug).toBe("salaberry-de-valleyfield");
      // Source + 5 Lots + 1 Valuation from the REAL first record.
      expect(body.mentionCount).toBeGreaterThanOrEqual(6);
      expect(body.canonicalCount).toBeGreaterThanOrEqual(6);
      // The reconciled project state was persisted for the read-model.
      const stored = await store.get(body.stateKey);
      const state = JSON.parse(new TextDecoder().decode(stored)) as {
        mentions: { type: string; label: string }[];
      };
      const lotLabels = state.mentions
        .filter((m) => m.type === "Lot")
        .map((m) => m.label);
      expect(lotLabels).toContain("Lot 4193751");
      const valuation = state.mentions.find((m) => m.type === "Valuation");
      expect(valuation?.label).toBe("Matricule 5114-86-8189");
    });
  });

  it("returns 502 with a typed error when the upstream fetch fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    const store = new MemoryStore();
    const app = sourcesRoute({ store });
    const res = await app.request("/api/sources/collect/avis-publics-valleyfield", {
      method: "POST",
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("network");
  });
});
