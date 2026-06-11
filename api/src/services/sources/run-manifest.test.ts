/**
 * run-manifest.test.ts — a RUN MANIFEST is the commit record / transaction-time
 * axis of the S3-first persistence model (SPEC_PERSISTENCE_S3_FIRST §1.1). It is
 * written LAST in a run as `runs/{source}/{runId}/manifest.jsonl`: one JSON
 * object per doc seen (NOT a JSON array), `{ sha256, sourceUrl, casKey, status,
 * publishedAt? }`. Manifest present ⇒ everything it references already exists.
 */
import { describe, expect, it } from "vitest";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  manifestKey,
  writeRunManifest,
  type RunManifestEntry,
} from "./run-manifest.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(
    key: string,
    body: Uint8Array | Buffer | string,
  ): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string"
        ? new TextEncoder().encode(body)
        : new Uint8Array(body);
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

function text(store: MemoryStore, key: string): string {
  return new TextDecoder().decode(store.objects.get(key)!);
}

describe("run-manifest", () => {
  it("manifestKey builds runs/{source}/{runId}/manifest.jsonl", () => {
    expect(manifestKey("avis-publics-testville", "20260608T093000-r")).toBe(
      "runs/avis-publics-testville/20260608T093000-r/manifest.jsonl",
    );
  });

  it("writes one JSON object per line (JSONL, not an array)", async () => {
    const store = new MemoryStore();
    const entries: readonly RunManifestEntry[] = [
      {
        sha256: "a".repeat(64),
        sourceUrl: "https://testville.qc.ca/avis/1",
        casKey: "raw/avis-publics-testville/cas/" + "a".repeat(64) + ".html",
        status: "new",
        publishedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        sha256: "b".repeat(64),
        sourceUrl: "https://testville.qc.ca/avis/2",
        casKey: "raw/avis-publics-testville/cas/" + "b".repeat(64) + ".html",
        status: "seen",
      },
    ];

    const key = await writeRunManifest(store, {
      source: "avis-publics-testville",
      runId: "20260608T093000-r",
      entries,
    });

    expect(key).toBe(
      "runs/avis-publics-testville/20260608T093000-r/manifest.jsonl",
    );
    const body = text(store, key);

    // JSONL: it must NOT parse as a single JSON value (no leading "[").
    expect(body.trimStart().startsWith("[")).toBe(false);
    expect(() => JSON.parse(body)).toThrow();

    const lines = body.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    expect(first).toMatchObject({
      sha256: "a".repeat(64),
      sourceUrl: "https://testville.qc.ca/avis/1",
      casKey: "raw/avis-publics-testville/cas/" + "a".repeat(64) + ".html",
      status: "new",
      publishedAt: "2026-06-01T00:00:00.000Z",
    });
    const second = JSON.parse(lines[1]!);
    expect(second.status).toBe("seen");
    // publishedAt is optional — it must be omitted, not null, when absent.
    expect("publishedAt" in second).toBe(false);
  });

  it("writes a trailing newline so the file is append-friendly", async () => {
    const store = new MemoryStore();
    const key = await writeRunManifest(store, {
      source: "s",
      runId: "r",
      entries: [
        {
          sha256: "c".repeat(64),
          sourceUrl: "https://x/1",
          casKey: "raw/s/cas/x.html",
          status: "new",
        },
      ],
    });
    expect(text(store, key).endsWith("\n")).toBe(true);
  });
});
