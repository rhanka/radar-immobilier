/**
 * recueil.test.ts — RECUEIL persists each raw document as a CAS object PLUS a
 * sidecar `.meta.json` (RawDocumentRecord), so every stored object is
 * self-describing on S3. Spec docs/spec/SPEC_PERSISTENCE_S3_FIRST.md §1.1.
 */
import { describe, expect, it } from "vitest";

import {
  rawMetaKey,
  RawDocumentRecordSchema,
  type RawDocument,
  type RawDocumentRef,
  type SourceAdapter,
} from "@radar/sources";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import { runRecueil, runRecueilWithManifest } from "./recueil.js";
import { manifestKey } from "./run-manifest.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  putCount = 0;
  async put(key: string, body: Uint8Array | Buffer | string): Promise<ObjectInfo> {
    this.putCount += 1;
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

function fakeAdapter(
  body: string,
  refOverrides: Partial<RawDocumentRef> = {},
  text?: string,
): SourceAdapter {
  const ref: RawDocumentRef = {
    sourceKind: "avis-publics",
    city: "testville",
    url: "https://testville.qc.ca/avis",
    discoveredAt: "2026-06-08T00:00:00.000Z",
    ...refOverrides,
  };
  const raw: RawDocument = {
    ref,
    sourceKind: "avis-publics",
    city: "testville",
    url: ref.url,
    fetchedAt: "2026-06-08T09:30:00.000Z",
    // A `.text` payload models a binary (PDF) doc whose adapter attached the
    // pdftotext projection — stored beside the binary at the companion textKey.
    contentType: text !== undefined ? "application/pdf" : "text/html",
    body: new TextEncoder().encode(body),
    ...(text !== undefined ? { text } : {}),
    provenance: {
      adapterVersion: "1.0.0",
      userAgent: "radar/test",
      fetchedViaObscura: false,
    },
  };
  return {
    kind: "avis-publics",
    city: "testville",
    version: "1.0.0",
    async *list() {
      yield ref;
    },
    async fetch() {
      return raw;
    },
    hash() {
      return raw.sha256 ?? "x";
    },
  };
}

describe("runRecueil — raw bytes + sidecar meta.json", () => {
  it("writes the CAS raw object and a parseable .meta.json record", async () => {
    const store = new MemoryStore();
    const out = await runRecueil(
      "avis-publics-testville",
      fakeAdapter("<html>avis 2026-58</html>"),
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const rec = out.records[0]!;
    expect(store.objects.has(rec.storageKey)).toBe(true);

    const metaKey = rawMetaKey(rec.storageKey);
    expect(store.objects.has(metaKey)).toBe(true);
    const meta = JSON.parse(
      new TextDecoder().decode(store.objects.get(metaKey)!),
    );
    expect(() => RawDocumentRecordSchema.parse(meta)).not.toThrow();
    expect(meta.sha256).toBe(rec.sha256);
    expect(meta.storageKey).toBe(rec.storageKey);
    expect(meta.sourceUrl).toBe("https://testville.qc.ca/avis");
  });

  it("persists the parseable text at <storageKey>.txt when the adapter attaches RawDocument.text (PDF)", async () => {
    const store = new MemoryStore();
    const out = await runRecueil(
      "reglements-urbanisme-testville",
      fakeAdapter(
        "%PDF-1.7 …binary…",
        {},
        "Règlement 999-01 concernant le zonage",
      ),
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const rec = out.records[0]!;
    // The binary body stays the canonical, openable evidence (drawer rawRef).
    expect(store.objects.has(rec.storageKey)).toBe(true);
    // The parseable text lands at the companion textKey (EXPLOITATION reads it).
    expect(rec.textKey).toBe(`${rec.storageKey}.txt`);
    expect(store.objects.has(rec.textKey!)).toBe(true);
    expect(
      new TextDecoder().decode(store.objects.get(rec.textKey!)!),
    ).toBe("Règlement 999-01 concernant le zonage");
  });

  it("attaches NO textKey for a text source (no RawDocument.text) — body IS the parseable substrate", async () => {
    const store = new MemoryStore();
    const out = await runRecueil(
      "avis-publics-testville",
      fakeAdapter("<html>avis 2026-58</html>"),
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.records[0]!.textKey).toBeUndefined();
  });

  it("BACK-FILLS the textKey on a re-run whose binary already exists (dedup) — text persisted even when the body is 'seen'", async () => {
    const store = new MemoryStore();
    const adapter = fakeAdapter(
      "%PDF-1.7 …binary…",
      {},
      "Règlement 999-01 concernant le zonage",
    );
    // 1st run stored binary + text.
    const first = await runRecueil(
      "reglements-urbanisme-testville",
      adapter,
      store,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const rec = first.records[0]!;

    // Simulate a PRIOR run (pre-fix) that stored ONLY the binary: drop the text
    // object, keep the deduped binary.
    store.objects.delete(rec.textKey!);
    expect(store.objects.has(rec.storageKey)).toBe(true);
    expect(store.objects.has(rec.textKey!)).toBe(false);

    // Re-run: the binary is deduped ("seen") but the text MUST be back-filled,
    // else EXPLOITATION would read record.textKey on an absent object.
    const second = await runRecueil(
      "reglements-urbanisme-testville",
      adapter,
      store,
    );
    expect(second.ok).toBe(true);
    expect(store.objects.has(rec.textKey!)).toBe(true);
    expect(
      new TextDecoder().decode(store.objects.get(rec.textKey!)!),
    ).toBe("Règlement 999-01 concernant le zonage");
  });

  it("persists source listing title and publishedAt in sidecar metadata", async () => {
    const store = new MemoryStore();
    const out = await runRecueil(
      "avis-publics-testville",
      fakeAdapter("<html>avis 2026-58</html>", {
        title: "Avis public du 8 juin",
        publishedAt: "2026-06-08",
      }),
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const rec = out.records[0]!;
    expect(rec.title).toBe("Avis public du 8 juin");
    expect(rec.publishedAt).toBe("2026-06-08");

    const meta = JSON.parse(
      new TextDecoder().decode(store.objects.get(rawMetaKey(rec.storageKey))!),
    );
    expect(meta.title).toBe("Avis public du 8 juin");
    expect(meta.publishedAt).toBe("2026-06-08");
  });
});

describe("runRecueilWithManifest — run manifest (commit record)", () => {
  it("first run writes runs/{source}/{runId}/manifest.jsonl with status new", async () => {
    const store = new MemoryStore();
    const out = await runRecueilWithManifest(
      "avis-publics-testville",
      fakeAdapter("<html>avis 2026-58</html>"),
      store,
      { runId: "20260608T093000-r" },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const key = manifestKey("avis-publics-testville", "20260608T093000-r");
    expect(key).toBe(
      "runs/avis-publics-testville/20260608T093000-r/manifest.jsonl",
    );
    expect(store.objects.has(key)).toBe(true);

    const body = new TextDecoder().decode(store.objects.get(key)!);
    const lines = body.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(out.records.length);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.status).toBe("new");
    expect(entry.sha256).toBe(out.records[0]!.sha256);
    expect(entry.casKey).toBe(out.records[0]!.storageKey);
    expect(entry.sourceUrl).toBe("https://testville.qc.ca/avis");
  });

  it("writes publishedAt from the persisted record into the manifest", async () => {
    const store = new MemoryStore();
    const out = await runRecueilWithManifest(
      "avis-publics-testville",
      fakeAdapter("<html>avis 2026-58</html>", {
        publishedAt: "2026-06-08",
      }),
      store,
      { runId: "run-dated" },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const key = manifestKey("avis-publics-testville", "run-dated");
    const body = new TextDecoder().decode(store.objects.get(key)!);
    const entry = JSON.parse(body.split("\n")[0]!);
    expect(entry.publishedAt).toBe("2026-06-08");
  });

  it("second run on byte-identical content is HEAD-skipped → status seen, no new raw object", async () => {
    const store = new MemoryStore();
    const body = "<html>avis 2026-58</html>";

    const first = await runRecueilWithManifest(
      "avis-publics-testville",
      fakeAdapter(body),
      store,
      { runId: "run-1" },
    );
    expect(first.ok).toBe(true);
    // After the first run, the raw object + its sidecar exist (2 puts) and the
    // manifest is the 3rd put.
    const rawKeysAfterFirst = [...store.objects.keys()].filter((k) =>
      k.includes("/cas/"),
    );
    const putsAfterFirst = store.putCount;

    const second = await runRecueilWithManifest(
      "avis-publics-testville",
      fakeAdapter(body),
      store,
      { runId: "run-2" },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // No NEW raw/cas object was written on the second run (HEAD-skip dedup).
    const rawKeysAfterSecond = [...store.objects.keys()].filter((k) =>
      k.includes("/cas/"),
    );
    expect(rawKeysAfterSecond).toEqual(rawKeysAfterFirst);
    // The only put of the second run is the manifest itself.
    expect(store.putCount).toBe(putsAfterFirst + 1);

    const key = manifestKey("avis-publics-testville", "run-2");
    const manifest = new TextDecoder().decode(store.objects.get(key)!);
    const lines = manifest.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.status).toBe("seen");
    expect(entry.sha256).toBe(second.records[0]!.sha256);
  });

  it("derives a default runId from fetchedAt when none is given", async () => {
    const store = new MemoryStore();
    const out = await runRecueilWithManifest(
      "avis-publics-testville",
      fakeAdapter("<html>avis</html>"),
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const expectedRunId = `${out.fetchedAt.replace(/[:.]/g, "")}-r`;
    const key = manifestKey("avis-publics-testville", expectedRunId);
    expect(store.objects.has(key)).toBe(true);
  });
});
