/**
 * migrate-fixtures-to-s3.test.ts — Lot 2c. Migre les villes « golden »
 * (`PV_FIXTURES`) vers l'objet-store CAS SANS réseau : on encode le `pvText`
 * (texte extrait pdftotext, PAS le PDF original) en bytes `text/plain`, on écrit
 * le raw CAS `raw/<source>/cas/<sha>.txt` + son sidecar `.meta.json`.
 * Spec docs/spec/SPEC_PERSISTENCE_S3_FIRST.md §3.
 *
 * ANTI-INVENTION (§0.2) : la meta étiquette honnêtement le contenu comme TEXTE
 * EXTRAIT migré d'une fixture — jamais comme le PDF source. Le worker live
 * backfillera le `raw/` PDF original au prochain refresh.
 */
import { describe, expect, it } from "vitest";

import {
  rawMetaKey,
  RawDocumentRecordSchema,
} from "@radar/sources";

import type { ObjectInfo, ObjectStore } from "../../storage/object-store.js";
import {
  migrateFixturesToS3,
  type FixtureToMigrate,
} from "./migrate-fixtures-to-s3.js";
import { PV_FIXTURES } from "./pv-seed.js";

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType?: string,
  ): Promise<ObjectInfo> {
    const bytes =
      typeof body === "string"
        ? new TextEncoder().encode(body)
        : new Uint8Array(body);
    this.objects.set(key, bytes);
    return { key, size: bytes.byteLength, contentType };
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

const FIXTURES: readonly FixtureToMigrate[] = [
  {
    citySlug: "testville-a",
    sourceId: "proces-verbaux-testville-a",
    sourceUrl: "https://testville-a.qc.ca/pv/2026-05.pdf",
    pvText: "PROCÈS-VERBAL séance ordinaire — règlement de zonage Z-3001.",
  },
  {
    citySlug: "testville-b",
    sourceId: "proces-verbaux-testville-b",
    sourceUrl: "https://testville-b.qc.ca/pv/2026-04.pdf",
    pvText: "PROCÈS-VERBAL — adoption du budget, taxes foncières.",
  },
  {
    citySlug: "testville-c",
    sourceId: "proces-verbaux-testville-c",
    sourceUrl: "https://testville-c.qc.ca/pv/2026-03.pdf",
    pvText: "PROCÈS-VERBAL — avis de motion règlement 2026-510, zone MxtV-2.",
  },
];

const now = () => new Date("2026-06-10T12:00:00.000Z");

describe("migrateFixturesToS3 — texte extrait des fixtures -> S3 CAS", () => {
  it("écrit 2N objets (raw CAS + meta.json) pour N fixtures", async () => {
    const store = new MemoryStore();
    const out = await migrateFixturesToS3(store, FIXTURES, { now });

    expect(out.migrated).toBe(FIXTURES.length);
    expect(out.skipped).toBe(0);
    // 2 objets par fixture : le raw CAS + son sidecar .meta.json.
    expect(store.objects.size).toBe(FIXTURES.length * 2);
  });

  it("chaque raw vit sous une clé CAS `raw/.../cas/...` (pas de date) avec son meta parseable", async () => {
    const store = new MemoryStore();
    await migrateFixturesToS3(store, FIXTURES, { now });

    const rawKeys = [...store.objects.keys()].filter(
      (k) => !k.endsWith(".meta.json"),
    );
    expect(rawKeys.length).toBe(FIXTURES.length);

    for (const rawKey of rawKeys) {
      // CAS : raw/<source>/cas/<sha>.txt — pas de composante date (yyyy/mm/dd).
      expect(rawKey).toMatch(/^raw\/[^/]+\/cas\/[a-f0-9]{64}\.txt$/);
      expect(rawKey).not.toMatch(/\/20\d\d\//);

      const metaKey = rawMetaKey(rawKey);
      expect(store.objects.has(metaKey)).toBe(true);
      const meta = JSON.parse(
        new TextDecoder().decode(store.objects.get(metaKey)!),
      );
      // Le sidecar parse en RawDocumentRecord.
      expect(() => RawDocumentRecordSchema.parse(meta)).not.toThrow();
      expect(meta.storageKey).toBe(rawKey);
      expect(meta.contentType).toMatch(/^text\/plain/);
    }
  });

  it("la meta est HONNÊTE : texte extrait migré d'une fixture, PAS le PDF source", async () => {
    const store = new MemoryStore();
    await migrateFixturesToS3(store, FIXTURES, { now });

    const metaKey = [...store.objects.keys()].find((k) =>
      k.endsWith(".meta.json"),
    )!;
    const meta = JSON.parse(
      new TextDecoder().decode(store.objects.get(metaKey)!),
    );

    // Provenance honnête : migration de fixture, jamais un vrai fetch réseau.
    expect(meta.provenance.version).toBe("fixture-migration");
    expect(meta.provenance.userAgent).toBe("radar/migration");
    expect(meta.provenance.viaObscura).toBe(false);

    // Étiquette explicite : c'est le TEXTE EXTRAIT, pas le PDF original.
    expect(meta.migration).toBeDefined();
    expect(meta.migration.obtentionMode).toBe("extracted-text");
    expect(meta.migration.source).toBe("fixture");
    expect(meta.migration.isOriginalPdf).toBe(false);
    expect(typeof meta.migration.note).toBe("string");
    expect(meta.migration.note.length).toBeGreaterThan(0);
  });

  it("est idempotent : un 2e passage ne réécrit rien (HEAD-skip)", async () => {
    const store = new MemoryStore();
    await migrateFixturesToS3(store, FIXTURES, { now });
    const sizeAfterFirst = store.objects.size;
    const snapshot = new Map(
      [...store.objects.entries()].map(([k, v]) => [k, new Uint8Array(v)]),
    );

    const second = await migrateFixturesToS3(store, FIXTURES, { now });

    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(FIXTURES.length);
    // Taille du store inchangée.
    expect(store.objects.size).toBe(sizeAfterFirst);
    // Aucun byte réécrit.
    for (const [k, v] of snapshot) {
      expect(store.objects.get(k)).toEqual(v);
    }
  });

  it("migre les PV_FIXTURES réelles par défaut (toutes en clé CAS)", async () => {
    const store = new MemoryStore();
    const out = await migrateFixturesToS3(store, undefined, { now });

    expect(PV_FIXTURES.length).toBeGreaterThan(0);
    expect(out.migrated).toBe(PV_FIXTURES.length);
    expect(store.objects.size).toBe(PV_FIXTURES.length * 2);
    for (const key of store.objects.keys()) {
      expect(key).toMatch(/^raw\/[^/]+\/cas\//);
    }
  });
});
